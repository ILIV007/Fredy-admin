/**
 * src/services/duplicate-detector.ts
 * v11.13.0: Complete refactor — two-layer dedup (Canonical ID + Content hash).
 *
 * Layer 1: Canonical ID check (fast, stable, content-independent)
 *   - Uses provider + stable ID (e.g., "github:owner/repo", "hackernews:12345")
 *   - Immune to URL variations (trailing slash, query params)
 *   - Immune to AI rewrite changes
 *
 * Layer 2: Content hash check (fallback for items without stable ID)
 *   - SHA-1 of normalized URL + title (NOT body — body changes with AI rewrite)
 *   - Catches cross-provider duplicates with same content
 *
 * Layer 3: URL check (cross-plugin detection)
 *   - Normalized URL (trailing slash removed, query params stripped)
 *
 * Storage: 3 KV entries per published item:
 *   fredy:dedup:canonical:<canonicalId>  → record
 *   fredy:dedup:hash:<hash>              → record
 *   fredy:dedup:url:<urlHash>            → record
 */

import { dedupKey } from "../core/storage/keys";
import { sha1 } from "../primitives/hash";
import { normalizeForDedup } from "../primitives/strings";
import type { ContentItem, DuplicateCheckResult, DedupRecord } from "../types/content";
import type { SourceItem } from "../types/api";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

export interface DuplicateDetectorDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly ttlHours?: number;
}

const DEFAULT_TTL_HOURS = 24 * 30; // 30 days

export class DuplicateDetector {
  private readonly ttlSeconds: number;

  constructor(private readonly deps: DuplicateDetectorDeps) {
    this.ttlSeconds = (deps.ttlHours ?? DEFAULT_TTL_HOURS) * 3600;
  }

  /**
   * Check if a content item is a duplicate.
   * v11.13.0: Three-layer check — canonical ID → URL → content hash.
   */
  async check(item: SourceItem | ContentItem): Promise<DuplicateCheckResult> {
    // Layer 1: Canonical ID check (fastest, most reliable).
    const canonicalId = this.extractCanonicalId(item);
    if (canonicalId) {
      const canonicalRecord = await this.findByCanonicalId(canonicalId);
      if (canonicalRecord) {
        this.deps.logger.info("quality.reject", {
          contentId: (item as ContentItem).id ?? (item as SourceItem).id,
          pluginId: (item as ContentItem).pluginId ?? (item as SourceItem).source,
          reason: "duplicate_canonical",
          canonicalId,
          existingId: canonicalRecord.contentId,
          age: `${Math.round((Date.now() - canonicalRecord.createdAt) / (3600 * 1000))}h`,
          message: "Duplicate blocked by canonical ID",
        });
        return { isDuplicate: true, reason: "canonical", existingId: canonicalRecord.contentId };
      }
    }

    // Layer 2: Normalized URL check.
    const normalizedUrl = this.normalizeUrl(item.url);
    if (normalizedUrl) {
      const urlRecord = await this.findByUrl(normalizedUrl);
      if (urlRecord) {
        this.deps.logger.info("quality.reject", {
          contentId: (item as ContentItem).id ?? (item as SourceItem).id,
          pluginId: (item as ContentItem).pluginId ?? (item as SourceItem).source,
          reason: "duplicate_url",
          url: normalizedUrl,
          existingId: urlRecord.contentId,
          message: "Duplicate blocked by URL",
        });
        return { isDuplicate: true, reason: "url", existingId: urlRecord.contentId };
      }
    }

    // Layer 3: Content hash (URL + title, NOT body — body changes with AI).
    const hash = this.computeContentHash(item);
    const hashRecord = await this.findByHash(hash);
    if (hashRecord) {
      this.deps.logger.info("quality.reject", {
        contentId: (item as ContentItem).id ?? (item as SourceItem).id,
        pluginId: (item as ContentItem).pluginId ?? (item as SourceItem).source,
        reason: "duplicate_hash",
        hash,
        existingId: hashRecord.contentId,
        message: "Duplicate blocked by content hash",
      });
      return { isDuplicate: true, reason: "hash", existingId: hashRecord.contentId };
    }

    return { isDuplicate: false, reason: null, existingId: null };
  }

  /**
   * Record a published content item in the dedup store.
   * v11.13.0: Writes 3 KV entries: canonical ID, URL, content hash.
   */
  async record(item: ContentItem): Promise<void> {
    await this.recordInternal({
      id: item.id,
      pluginId: item.pluginId,
      url: item.url,
      title: item.title,
      body: item.body,
      source: item.source,
      raw: item.raw,
    });
  }

  /** v9.3.1: Record a ReadyContent after successful publish. */
  async recordPublished(content: {
    readonly id: string;
    readonly pluginId: string;
    readonly headline: string | null;
    readonly text: string;
    readonly sourceUrl: string;
  }): Promise<void> {
    await this.recordInternal({
      id: content.id,
      pluginId: content.pluginId,
      url: content.sourceUrl,
      title: content.headline ?? content.id,
      body: "",
      source: content.pluginId,
      raw: null,
    });
  }

  /** Internal recording logic — shared by record() and recordPublished(). */
  private async recordInternal(item: {
    id: string;
    pluginId: string;
    url: string;
    title: string;
    body: string;
    source: string;
    raw: SourceItem | null;
  }): Promise<void> {
    const canonicalId = this.extractCanonicalId({
      source: item.source,
      url: item.url,
      title: item.title,
      body: item.body,
      id: item.id,
      raw: item.raw,
    } as unknown as SourceItem);
    const normalizedUrl = this.normalizeUrl(item.url);
    const hash = this.computeContentHash({
      url: item.url,
      title: item.title,
      body: item.body,
    });
    const now = Date.now();

    const record: DedupRecord = {
      hash,
      url: normalizedUrl ?? item.url,
      titleHash: this.computeTitleHash(item.title),
      contentId: item.id,
      pluginId: item.pluginId,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
    };

    // Write all 3 entries (fire-and-forget for URL and hash, await canonical).
    if (canonicalId) {
      await this.deps.kv.setJson(`fredy:dedup:canonical:${canonicalId}`, record, this.ttlSeconds);
    }
    if (normalizedUrl) {
      const urlHash = sha1(normalizedUrl);
      void this.deps.kv.setJson(`fredy:dedup:url:${urlHash}`, record, this.ttlSeconds);
    }
    void this.deps.kv.setJson(dedupKey(hash), record, this.ttlSeconds);
  }

  // ─── Layer 1: Canonical ID ──────────────────────────────

  /**
   * v11.13.0: Extract a stable canonical ID from a source item.
   * This is content-independent — it doesn't change with AI rewrites,
   * star counts, ranking positions, or fetch time.
   *
   * Format: "provider:stableId"
   *
   * GitHub: "github:owner/repo"
   * GitHub Releases: "github-releases:owner/repo:tag"
   * GitHub Events: "github-events:owner/repo:eventType:eventId"
   * GitHub Security: "github-security:GHSA-xxx"
   * GitHub Trending: "github-trending:owner/repo"
   * HackerNews: "hackernews-algolia:12345"
   * Dev.to: "devto:12345" or "devto:slug"
   * Reddit: "reddit-v2:postId"
   * Product Hunt: "producthunt:slug"
   * StackExchange: "stackexchange:questionId"
   * Cloudflare Blog: "cloudflare-blog:slug"
   * HuggingFace: "huggingface-blog:slug"
   * OpenAI News: "openai-news:slug"
   * NASA: "nasa:date"
   * XKCD: "xkcd:comicId"
   */
  private extractCanonicalId(item: SourceItem | ContentItem): string | null {
    const source = (item as ContentItem).pluginId ?? (item as SourceItem).source;
    const url = item.url;
    const raw = (item as ContentItem).raw ?? item;
    const metadata = ((raw as SourceItem).metadata ?? {}) as Record<string, unknown>;

    // GitHub repos — extract owner/repo from URL.
    if (source === "github" || source === "github-trending") {
      const match = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(url);
      if (match) return `${source}:${match[1]}/${match[2]}`;
      return null;
    }

    // GitHub Releases — owner/repo + tag.
    if (source === "github-releases") {
      const match = /github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/i.exec(url);
      if (match) return `github-releases:${match[1]}/${match[2]}:${match[3]}`;
      // Fallback: use repo + tag from metadata.
      const repo = metadata["repo"] as string | undefined;
      const tag = metadata["tag"] as string | undefined;
      if (repo && tag) return `github-releases:${repo}:${tag}`;
      return null;
    }

    // GitHub Events — owner/repo + eventType + eventId.
    if (source === "github-events") {
      const repo = metadata["repo"] as string | undefined;
      const eventType = metadata["eventType"] as string | undefined;
      const itemId = (raw as SourceItem).id;
      if (repo && eventType && itemId) return `github-events:${repo}:${eventType}:${itemId}`;
      return null;
    }

    // GitHub Security — GHSA ID.
    if (source === "github-security") {
      const ghsaId = metadata["ghsaId"] as string | undefined;
      if (ghsaId) return `github-security:${ghsaId}`;
      const match = /advisories\/(GHSA-[a-z0-9-]+)/i.exec(url);
      if (match) return `github-security:${match[1]}`;
      return null;
    }

    // HackerNews — story ID from item ID or metadata.
    if (source === "hackernews-algolia" || source === "hackernews") {
      const hnId = metadata["hnId"] as string | undefined;
      if (hnId) return `hackernews-algolia:${hnId}`;
      // Extract from item ID: "hn-12345" → "12345"
      const idMatch = /hn-(\d+)/.exec((raw as SourceItem).id);
      if (idMatch) return `hackernews-algolia:${idMatch[1]}`;
      return null;
    }

    // Dev.to — article ID from metadata or URL slug.
    if (source === "devto") {
      const articleId = metadata["articleId"] as string | undefined;
      if (articleId) return `devto:${articleId}`;
      // Fallback: extract slug from URL.
      const match = /dev\.to\/([^/]+)\/([^/?#]+)/i.exec(url);
      if (match) return `devto:${match[1]}/${match[2]}`;
      return null;
    }

    // Reddit — post ID from metadata.
    if (source === "reddit-v2" || source === "reddit") {
      const postId = (raw as SourceItem).id;
      if (postId) return `reddit-v2:${postId}`;
      return null;
    }

    // Product Hunt — slug from URL.
    if (source === "producthunt") {
      const match = /producthunt\.com\/(?:posts|products)\/([^/?#]+)/i.exec(url);
      if (match) return `producthunt:${match[1]}`;
      return null;
    }

    // StackExchange — question ID from metadata.
    if (source === "stackexchange") {
      const qId = metadata["questionId"] as string | undefined;
      if (qId) return `stackexchange:${qId}`;
      const match = /stackoverflow\.com\/questions\/(\d+)/i.exec(url);
      if (match) return `stackexchange:${match[1]}`;
      return null;
    }

    // RSS-based providers — extract slug from URL.
    if (source === "cloudflare-blog") {
      const match = /blog\.cloudflare\.com\/([^/?#]+)/i.exec(url);
      if (match) return `cloudflare-blog:${match[1]}`;
      return null;
    }
    if (source === "huggingface-blog") {
      const match = /huggingface\.co\/blog\/([^/?#]+)/i.exec(url);
      if (match) return `huggingface-blog:${match[1]}`;
      return null;
    }
    if (source === "openai-news") {
      const match = /openai\.com\/(?:index|blog)\/([^/?#]+)/i.exec(url);
      if (match) return `openai-news:${match[1]}`;
      return null;
    }

    // NASA — date-based (unique per day).
    if (source === "nasa") {
      const match = /apod.*date=([^&]+)/i.exec(url) || /ap(\d{6})/i.exec(url);
      if (match) return `nasa:${match[1]}`;
      return null;
    }

    // XKCD — comic ID from URL.
    if (source === "xkcd") {
      const match = /xkcd\.com\/(\d+)/i.exec(url);
      if (match) return `xkcd:${match[1]}`;
      return null;
    }

    // Unknown provider — no canonical ID.
    return null;
  }

  private async findByCanonicalId(canonicalId: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:canonical:${canonicalId}`);
  }

  // ─── Layer 2: Normalized URL ────────────────────────────

  /**
   * v11.13.0: Normalize URL for dedup.
   * - Remove trailing slash
   * - Remove query parameters (except essential ones)
   * - Lowercase hostname
   * - Remove www. prefix
   */
  private normalizeUrl(url: string): string | null {
    if (!url || url.length < 10) return null;
    try {
      const parsed = new URL(url);
      // Remove trailing slash from pathname.
      let pathname = parsed.pathname;
      if (pathname.endsWith("/") && pathname.length > 1) {
        pathname = pathname.slice(0, -1);
      }
      // Remove www. prefix.
      let hostname = parsed.hostname;
      if (hostname.startsWith("www.")) {
        hostname = hostname.slice(4);
      }
      // Reconstruct without query params (most are tracking).
      return `${parsed.protocol}//${hostname}${pathname}`;
    } catch {
      return null;
    }
  }

  private async findByUrl(normalizedUrl: string): Promise<DedupRecord | null> {
    const urlHash = sha1(normalizedUrl);
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:url:${urlHash}`);
  }

  // ─── Layer 3: Content Hash ──────────────────────────────

  /**
   * v11.13.0: Compute content hash from URL + title (NOT body).
   * Previously hashed the body — but body changes with AI rewrite,
   * making dedup useless for AI-processed content.
   * Now hashes: normalizedUrl + normalizedTitle
   */
  private computeContentHash(item: { url?: string; title?: string; body?: string }): string {
    const normalizedUrl = this.normalizeUrl(item.url ?? "") ?? "";
    const normalizedTitle = normalizeForDedup(item.title ?? "");
    // If both are empty, this won't match anything useful — but won't false-positive either.
    return sha1(`${normalizedUrl}|${normalizedTitle}`);
  }

  /** Compute a title hash (for similar-title detection, retained for future use). */
  private computeTitleHash(title: string): string {
    const normalized = normalizeForDedup(title).slice(0, 100);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `t${Math.abs(hash).toString(36)}`;
  }

  private async findByHash(hash: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(dedupKey(hash));
  }

  // ─── Admin ──────────────────────────────────────────────

  /** Clear all dedup records. */
  async clear(): Promise<void> {
    const keys = await this.deps.kv.list("fredy:dedup:");
    await Promise.all(keys.map((k) => this.deps.kv.delete(k)));
  }
}

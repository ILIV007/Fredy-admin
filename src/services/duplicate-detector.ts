/**
 * src/services/duplicate-detector.ts
 * Detects duplicate content using URL, hash, and similar title matching.
 *
 * Stores dedup records in KV with a TTL (default 7 days).
 * See FREDY_GUIDELINES.md §9.3 (Deduplication).
 */

import { dedupKey } from "../core/storage/keys";
import { sha1 } from "../primitives/hash";
import { normalizeForDedup } from "../primitives/strings";
import type { ContentItem, DuplicateCheckResult, DedupRecord } from "../types/content";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

export interface DuplicateDetectorDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly ttlHours?: number;
}

const DEFAULT_TTL_HOURS = 24 * 30; // 30 days — strong dedup so published posts never reappear

export class DuplicateDetector {
  private readonly ttlSeconds: number;

  constructor(private readonly deps: DuplicateDetectorDeps) {
    this.ttlSeconds = (deps.ttlHours ?? DEFAULT_TTL_HOURS) * 3600;
  }

  /**
   * Check if a content item is a duplicate.
   * Checks: URL, content hash, similar title.
   */
  async check(item: ContentItem): Promise<DuplicateCheckResult> {
    // 1. URL check — but combine URL with item ID to avoid false positives
    //    when multiple items share the same URL (e.g., all joke items have
    //    url: "https://v2.jokeapi.dev").
    if (item.url) {
      // If URL is a generic API endpoint (no meaningful path), skip URL dedup
      // and rely on content hash instead.
      const isGenericUrl = this.isGenericApiUrl(item.url);
      if (!isGenericUrl) {
        const urlRecord = await this.findByUrl(item.url);
        if (urlRecord) {
          this.deps.logger.info("quality.reject", {
            contentId: item.id,
            pluginId: item.pluginId,
            reason: "duplicate_url",
            existingId: urlRecord.contentId,
          });
          return {
            isDuplicate: true,
            reason: "url",
            existingId: urlRecord.contentId,
          };
        }
      }
    }

    // 2. Hash check (content body).
    const hash = await this.computeHash(item);
    const hashRecord = await this.findByHash(hash);
    if (hashRecord) {
      this.deps.logger.info("quality.reject", {
        contentId: item.id,
        pluginId: item.pluginId,
        reason: "duplicate_hash",
        existingId: hashRecord.contentId,
      });
      return {
        isDuplicate: true,
        reason: "hash",
        existingId: hashRecord.contentId,
      };
    }

    // 3. Similar title check.
    const titleHash = this.computeTitleHash(item.title);
    const titleRecord = await this.findByTitleHash(titleHash);
    if (titleRecord) {
      this.deps.logger.info("quality.reject", {
        contentId: item.id,
        pluginId: item.pluginId,
        reason: "duplicate_title",
        existingId: titleRecord.contentId,
      });
      return {
        isDuplicate: true,
        reason: "title",
        existingId: titleRecord.contentId,
      };
    }

    return { isDuplicate: false, reason: null, existingId: null };
  }

  /** Record a content item in the dedup store. Called after successful processing. */
  async record(item: ContentItem): Promise<void> {
    const hash = await this.computeHash(item);
    const titleHash = this.computeTitleHash(item.title);
    const now = Date.now();

    const record: DedupRecord = {
      hash,
      url: item.url,
      titleHash,
      contentId: item.id,
      pluginId: item.pluginId,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
    };

    // Store by hash (primary key).
    await this.deps.kv.setJson(dedupKey(hash), record, this.ttlSeconds);

    // Also store by URL for fast lookup.
    if (item.url) {
      await this.deps.kv.setJson(`fredy:dedup:url:${await this.hashUrl(item.url)}`, record, this.ttlSeconds);
    }

    // Also store by title hash.
    await this.deps.kv.setJson(`fredy:dedup:title:${titleHash}`, record, this.ttlSeconds);
  }

  /** Compute the content hash (SHA-1 of normalized body).
   *  IMPORTANT: if the body is empty (common for HackerNews items that
   *  only have a title), fall back to hashing the URL + title. Otherwise
   *  all empty-body items would hash to the same value (sha1 of empty
   *  string) and be falsely detected as duplicates of each other. */
  private async computeHash(item: ContentItem): Promise<string> {
    const normalizedBody = normalizeForDedup(item.body ?? "");
    // If body is empty/whitespace, hash URL + title instead.
    if (!normalizedBody || normalizedBody.length < 3) {
      const fallback = normalizeForDedup(`${item.url ?? ""}|${item.title ?? ""}`);
      return sha1(`fallback:${fallback}`);
    }
    return sha1(normalizedBody);
  }

  /** Compute a title hash (for similar-title detection). */
  private computeTitleHash(title: string): string {
    const normalized = normalizeForDedup(title).slice(0, 100);
    // Simple hash for title — not cryptographic.
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `t${Math.abs(hash).toString(36)}`;
  }

  /** Hash a URL for KV key (URLs can be long). */
  private async hashUrl(url: string): Promise<string> {
    // Use SHA-1 for collision resistance — djb2 (32-bit) had collision risk.
    return sha1(`url:${url}`);
  }

  /** Check if URL is a generic API endpoint (no meaningful path).
   *  These URLs are shared by all items from that API and shouldn't be
   *  used for dedup (e.g., https://v2.jokeapi.dev). */
  private isGenericApiUrl(url: string): boolean {
    try {
      const u = new URL(url);
      const path = u.pathname;
      // No path or just "/" = generic endpoint
      if (path === "/" || path === "" || path.length < 3) return true;
      // Known API hosts
      const apiHosts = ["v2.jokeapi.dev", "api.nasa.gov", "api.stackexchange.com", "api.github.com", "hacker-news.firebaseio.com"];
      if (apiHosts.includes(u.hostname)) return true;
      return false;
    } catch { /* non-fatal */
      return true; // Invalid URL = treat as generic
    }
  }

  /** Find a dedup record by URL. */
  private async findByUrl(url: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:url:${await this.hashUrl(url)}`);
  }

  /** Find a dedup record by content hash. */
  private async findByHash(hash: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(dedupKey(hash));
  }

  /** Find a dedup record by title hash. */
  private async findByTitleHash(titleHash: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:title:${titleHash}`);
  }

  /** Clear all dedup records (for the admin panel). */
  async clear(): Promise<void> {
    const keys = await this.deps.kv.list("fredy:dedup:");
    await Promise.all(keys.map((k) => this.deps.kv.delete(k)));
  }
}

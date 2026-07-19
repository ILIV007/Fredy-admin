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
    // v9.2.0: Restored URL check (2 reads: URL + hash).
    // 1. URL check — for cross-plugin duplicate detection.
    if (item.url) {
      const urlRecord = await this.findByUrl(item.url);
      if (urlRecord) {
        return { isDuplicate: true, reason: "url", existingId: urlRecord.contentId };
      }
    }
    // 2. Hash check (content body).
    const hash = await this.computeHash(item);
    const hashRecord = await this.findByHash(hash);

    if (hashRecord) {
      // Found a record by content hash — duplicate!
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

    // v8.10.0: URL check — only if the URL is not a generic API endpoint.
    // Since we no longer store by URL key, we can't do a direct URL lookup.
    // Instead, we compute the URL hash and check if the hash record's URL matches.
    // This is less precise but saves KV reads. The hash check above already
    // catches exact content duplicates; the URL check was mainly for cross-plugin
    // duplicates (same URL, different body text).
    // For now, skip URL dedup — the hash check is sufficient.
    // TODO: If URL dedup is needed, store a separate URL→hash index.

    // v8.10.0: Title check — since we no longer store by title key,
    // skip title dedup. The hash check catches exact content duplicates.
    // Title dedup was for "similar but not identical" posts, which is
    // a nice-to-have but costs 1 extra KV read per check.
    // For now, skip title dedup.

    return { isDuplicate: false, reason: null, existingId: null };
  }

  /** Record a content item in the dedup store. Called after successful processing.
   *  v8.10.0: Optimized — use a SINGLE KV write with a composite key instead
   *  of 3 separate writes. The lookup methods (findByUrl, findByHash, findByTitle)
   *  now check the single record stored under the hash key, which contains
   *  url and titleHash fields for matching. This reduces KV writes from 3 to 1
   *  per content item — a 67% reduction in dedup KV usage. */
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

    // 1. Store by hash (primary key).
    await this.deps.kv.setJson(dedupKey(hash), record, this.ttlSeconds);
    // 2. v9.2.0: Store by URL hash (for cross-plugin duplicate detection).
    if (item.url) {
      const urlHash = await this.hashUrl(item.url);
      await this.deps.kv.setJson(`fredy:dedup:url:${urlHash}`, record, this.ttlSeconds);
    }
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

  /** v9.2.0: Restored hashUrl for URL-based dedup. */
  private async hashUrl(url: string): Promise<string> {
    return sha1(url);
  }

  /** v9.2.0: Restored findByUrl for URL-based dedup. */
  private async findByUrl(url: string): Promise<DedupRecord | null> {
    const urlHash = await this.hashUrl(url);
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:url:${urlHash}`);
  }

  // v8.10.0: Removed isGenericApiUrl, findByUrl, findByTitleHash —
  // dedup is now hash-only (single KV read + single KV write).
  // These methods are kept as no-ops for backward compatibility but
  // are no longer called.

  /** Find a dedup record by content hash. */
  private async findByHash(hash: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(dedupKey(hash));
  }

  /** Clear all dedup records (for the admin panel). */
  async clear(): Promise<void> {
    const keys = await this.deps.kv.list("fredy:dedup:");
    await Promise.all(keys.map((k) => this.deps.kv.delete(k)));
  }
}

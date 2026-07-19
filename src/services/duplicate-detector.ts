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
    // v9.1.0: Restored URL check (2 reads: URL + hash, not 3).
    // 1. URL check — for cross-plugin duplicate detection.
    if (item.url) {
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

    // v9.1.0: Title-fuzzy check remains removed (was least valuable).

    return { isDuplicate: false, reason: null, existingId: null };
  }

  /** Record a content item in the dedup store. Called after successful processing.
   *  v9.1.0: Restored URL-based matching (2 writes per item, not 3).
   *  Title-fuzzy matching remains removed (it was the least valuable).
   *  This is a tradeoff: 2 writes instead of 1, but URL dedup catches
   *  cross-plugin duplicates that hash-only would miss. */
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

    // 2. v9.1.0: Store by URL hash (for cross-plugin duplicate detection).
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

  // v9.1.0: Restored hashUrl and findByUrl for URL-based dedup.

  /** Hash a URL for KV key. */
  private async hashUrl(url: string): Promise<string> {
    return sha1(url);
  }

  /** Find a dedup record by URL. */
  private async findByUrl(url: string): Promise<DedupRecord | null> {
    const urlHash = await this.hashUrl(url);
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:url:${urlHash}`);
  }

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

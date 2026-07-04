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

const DEFAULT_TTL_HOURS = 24 * 7; // 7 days

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
    // 1. URL check.
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
      await this.deps.kv.setJson(`fredy:dedup:url:${this.hashUrl(item.url)}`, record, this.ttlSeconds);
    }

    // Also store by title hash.
    await this.deps.kv.setJson(`fredy:dedup:title:${titleHash}`, record, this.ttlSeconds);
  }

  /** Compute the content hash (SHA-1 of normalized body). */
  private async computeHash(item: ContentItem): Promise<string> {
    const normalized = normalizeForDedup(item.body);
    return sha1(normalized);
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
  private hashUrl(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /** Find a dedup record by URL. */
  private async findByUrl(url: string): Promise<DedupRecord | null> {
    return this.deps.kv.getJson<DedupRecord>(`fredy:dedup:url:${this.hashUrl(url)}`);
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

/**
 * src/services/config-cache.ts
 * In-memory cache for settings. Per-isolate, short TTL.
 *
 * Cloudflare Workers reuse isolates across requests, so this cache absorbs
 * the KV read latency for hot settings. Writes invalidate the cache entry
 * so the next read picks up the new value.
 *
 * v7.4.1: TTL reduced from 30s to 5s to minimize cross-isolate staleness.
 * The bot and the Manager dashboard often run on different isolates, so
 * when one writes, the other may serve stale data for up to TTL seconds.
 * 5s is short enough that the admin perceives near-real-time sync while
 * still providing meaningful KV read reduction for hot paths (scheduler tick,
 * queue maintenance).
 *
 * See ARCHITECTURE_RULES.md §18.1 (cache aggressively, invalidate explicitly).
 */

import type { FredySettings } from "../types/config";

export interface ConfigCacheDeps {
  readonly ttlMs?: number;
}

interface CacheEntry {
  readonly value: FredySettings;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 5_000; // 5 seconds (was 30s — caused cross-isolate staleness)

export class ConfigCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(deps: ConfigCacheDeps = {}) {
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Get cached settings for an admin. Returns null on miss or expiry. */
  get(adminId: string): FredySettings | null {
    const entry = this.cache.get(adminId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(adminId);
      return null;
    }
    return entry.value;
  }

  /** Cache settings for an admin. */
  set(adminId: string, value: FredySettings): void {
    this.cache.set(adminId, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Invalidate the cached entry for an admin (call after writes). */
  invalidate(adminId: string): void {
    this.cache.delete(adminId);
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Get cache stats for the debug dashboard. */
  stats(): { readonly size: number; readonly ttlMs: number } {
    return { size: this.cache.size, ttlMs: this.ttlMs };
  }
}

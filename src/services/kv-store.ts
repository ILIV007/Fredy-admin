/**
 * src/services/kv-store.ts
 * Typed KV store with batched stats (in-memory cache + threshold flush).
 *
 * Pattern reused from AI Admin src/kv.js (lines 3635-3764): free tier limits
 * KV writes to 1 000/day. Stat counters are batched in-memory per isolate and
 * flushed every BATCH_FLUSH_THRESHOLD increments or on ctx.waitUntil(flushAll).
 *
 * Also implements:
 *   - Media group buffering (per-item keys, 180s TTL)
 *   - Scheduling queue (silent fallback for Telegram schedule_date failures)
 *
 * See ARCHITECTURE_RULES.md §7.1, §21.14.
 */

import { STATS_BATCH_FLUSH_THRESHOLD } from "../core/constants";
import type { Result } from "../core/result";
import { tryAsync } from "../core/result";
import type { Env } from "../types/env";

export interface KVStoreDeps {
  readonly kv: KVNamespace;
  readonly env?: Env;
}

// ────────────────────────────────────────────────────────────
// Batched stats (per-isolate in-memory cache)
// ────────────────────────────────────────────────────────────

interface StatEntry {
  processed: number;
  published: number;
  rejected: number;
  failed: number;
  _count: number;
}

const _statsCache = {
  perAdmin: new Map<string, StatEntry>(),
  global: { processed: 0, published: 0, rejected: 0, failed: 0, _count: 0 } as StatEntry,
};

export type StatField = "processed" | "published" | "rejected" | "failed";

// ────────────────────────────────────────────────────────────
// KVStore class
// ────────────────────────────────────────────────────────────

export class KVStore {
  constructor(private readonly deps: KVStoreDeps) {}

  // ────────────────────────────────────────────────────────────
  // Basic get/set/delete/list
  // ────────────────────────────────────────────────────────────

  /** Get a string value. Returns null if missing. */
  async get(key: string): Promise<string | null> {
    return this.deps.kv.get(key);
  }

  /** Get and JSON.parse a value. Returns null if missing or invalid. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.deps.kv.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Set a string value with optional TTL (in seconds). */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = ttlSeconds
      ? { expirationTtl: ttlSeconds }
      : {};
    await this.deps.kv.put(key, value, options);
  }

  /** Set a JSON value with optional TTL. */
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  /** Delete a key. */
  async delete(key: string): Promise<void> {
    await this.deps.kv.delete(key);
  }

  /** List keys with a prefix. Returns up to `limit` keys (default 100, max 1000). */
  async list(prefix: string, limit = 100): Promise<readonly string[]> {
    const result = await this.deps.kv.list({ prefix, limit: Math.min(limit, 1000) });
    return result.keys.map((k) => k.name);
  }

  /** Safe getJson — never throws, returns Result. */
  async safeGetJson<T>(key: string): Promise<Result<T | null, Error>> {
    return tryAsync(this.getJson<T>(key));
  }

  // ────────────────────────────────────────────────────────────
  // Batched stats (in-memory cache, flush on threshold)
  // ────────────────────────────────────────────────────────────

  /**
   * Increment a per-admin stat counter.
   * Uses in-memory batching: only writes to KV every BATCH_FLUSH_THRESHOLD calls.
   */
  async bumpStats(adminId: string | number, field: StatField): Promise<void> {
    const key = String(adminId);
    let entry = _statsCache.perAdmin.get(key);
    if (!entry) {
      entry = { processed: 0, published: 0, rejected: 0, failed: 0, _count: 0 };
      _statsCache.perAdmin.set(key, entry);
    }
    entry[field] = (entry[field] ?? 0) + 1;
    entry._count++;

    if (entry._count >= STATS_BATCH_FLUSH_THRESHOLD) {
      await this._flushAdminStats(key);
    }
  }

  /** Increment the global stat counter (same batching logic). */
  async bumpGlobalStats(field: StatField): Promise<void> {
    _statsCache.global[field] = (_statsCache.global[field] ?? 0) + 1;
    _statsCache.global._count++;

    if (_statsCache.global._count >= STATS_BATCH_FLUSH_THRESHOLD) {
      await this._flushGlobalStats();
    }
  }

  /** Flush a specific admin's cached stats to KV. */
  private async _flushAdminStats(adminId: string): Promise<void> {
    const entry = _statsCache.perAdmin.get(adminId);
    if (!entry || entry._count === 0) return;

    try {
      // The admin's full state blob (which includes stats) is loaded, updated, and saved.
      // This requires reading the state, but state changes rarely so the race is acceptable.
      const stateKey = `fredy:state:${adminId}`;
      const state = await this.getJson<Record<string, unknown>>(stateKey) ?? {};
      const stats = (state["stats"] as Record<string, number>) ?? {
        processed: 0,
        published: 0,
        rejected: 0,
        failed: 0,
      };
      stats.processed = (stats.processed ?? 0) + entry.processed;
      stats.published = (stats.published ?? 0) + entry.published;
      stats.rejected = (stats.rejected ?? 0) + entry.rejected;
      stats.failed = (stats.failed ?? 0) + entry.failed;
      state["stats"] = stats;
      await this.setJson(stateKey, state);

      // Reset cache counters (keep the map entry for fast access).
      entry.processed = 0;
      entry.published = 0;
      entry.rejected = 0;
      entry.failed = 0;
      entry._count = 0;
    } catch (error) {
      console.error("[kv] _flushAdminStats failed:", error instanceof Error ? error.message : error);
    }
  }

  /** Flush global cached stats to KV. */
  private async _flushGlobalStats(): Promise<void> {
    const g = _statsCache.global;
    if (g._count === 0) return;

    try {
      const key = "fredy:global:stats";
      const cur = await this.getJson<Record<string, number>>(key) ?? {
        processed: 0,
        published: 0,
        rejected: 0,
        failed: 0,
      };
      cur.processed = (cur.processed ?? 0) + g.processed;
      cur.published = (cur.published ?? 0) + g.published;
      cur.rejected = (cur.rejected ?? 0) + g.rejected;
      cur.failed = (cur.failed ?? 0) + g.failed;
      await this.setJson(key, cur);

      g.processed = 0;
      g.published = 0;
      g.rejected = 0;
      g.failed = 0;
      g._count = 0;
    } catch (error) {
      console.error("[kv] _flushGlobalStats failed:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Flush ALL pending stats to KV. Call this at the end of a request
   * (via ctx.waitUntil) to ensure no increments are lost.
   */
  async flushAllStats(): Promise<void> {
    const adminIds = Array.from(_statsCache.perAdmin.keys());
    await Promise.all([
      ...adminIds.map((id) => this._flushAdminStats(id)),
      this._flushGlobalStats(),
    ]);
  }

  /** Read global stats (merges cache + KV). */
  async getGlobalStats(): Promise<{ processed: number; published: number; rejected: number; failed: number }> {
    const base = await this.getJson<{ processed: number; published: number; rejected: number; failed: number }>(
      "fredy:global:stats",
    ) ?? { processed: 0, published: 0, rejected: 0, failed: 0 };
    return {
      processed: (base.processed ?? 0) + (_statsCache.global.processed ?? 0),
      published: (base.published ?? 0) + (_statsCache.global.published ?? 0),
      rejected: (base.rejected ?? 0) + (_statsCache.global.rejected ?? 0),
      failed: (base.failed ?? 0) + (_statsCache.global.failed ?? 0),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Media group buffering (per-item keys, no race condition)
  // ────────────────────────────────────────────────────────────

  /** Save one item from a media group (album). TTL: 180s. */
  async saveMediaGroupItem(
    groupId: string,
    messageId: number,
    item: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const key = `fredy:mg:${groupId}:${messageId}`;
    await this.setJson(key, item, 180);
  }

  /** List all items in a media group, sorted by message_id. */
  async listMediaGroupItems(groupId: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
    try {
      const list = await this.deps.kv.list({ prefix: `fredy:mg:${groupId}:`, limit: 100 });
      const items: Array<{ messageId: number; data: Readonly<Record<string, unknown>> }> = [];
      for (const k of list.keys) {
        const raw = await this.deps.kv.get(k.name);
        if (raw) {
          try {
            const data = JSON.parse(raw) as Readonly<Record<string, unknown>>;
            const messageId = Number(k.name.split(":")[3] ?? 0);
            items.push({ messageId, data });
          } catch {
            // skip invalid
          }
        }
      }
      items.sort((a, b) => a.messageId - b.messageId);
      return items.map((i) => i.data);
    } catch {
      return [];
    }
  }

  /** Delete all items in a media group. */
  async deleteMediaGroup(groupId: string): Promise<void> {
    try {
      const list = await this.deps.kv.list({ prefix: `fredy:mg:${groupId}:`, limit: 100 });
      for (const k of list.keys) {
        await this.deps.kv.delete(k.name);
      }
    } catch {
      // ignore
    }
  }

  // ────────────────────────────────────────────────────────────
  // Scheduling queue (silent fallback for Telegram schedule_date)
  // ────────────────────────────────────────────────────────────

  /** Enqueue a scheduled message. TTL: 7 days. */
  async enqueueScheduled(
    item: {
      readonly id: string;
      readonly scheduledTime: number;
      readonly chatId: number | string;
      readonly text: string;
      readonly parseMode?: string;
      readonly mediaType?: string;
      readonly mediaFileId?: string | null;
      readonly mediaGroupItems?: readonly unknown[];
    },
  ): Promise<void> {
    if (!item.scheduledTime || !item.id) return;
    const key = `fredy:sched:queue:${item.scheduledTime}:${item.id}`;
    await this.setJson(key, item, 7 * 24 * 3600);
  }

  /** List all scheduled items that are due (scheduledTime <= now). */
  async listDueScheduled(now = Date.now()): Promise<readonly (Readonly<Record<string, unknown>> & { _kvKey: string })[]> {
    try {
      const list = await this.deps.kv.list({ prefix: "fredy:sched:queue:", limit: 100 });
      const due: Array<(Readonly<Record<string, unknown>> & { _kvKey: string })> = [];
      for (const k of list.keys) {
        const parts = k.name.split(":");
        const ts = Number(parts[3] ?? 0);
        if (ts <= now) {
          const raw = await this.deps.kv.get(k.name);
          if (raw) {
            try {
              const item = JSON.parse(raw) as Readonly<Record<string, unknown>>;
              due.push({ ...item, _kvKey: k.name });
            } catch {
              // skip invalid
            }
          }
        }
      }
      due.sort((a, b) => Number(a["scheduledTime"]) - Number(b["scheduledTime"]));
      return due;
    } catch {
      return [];
    }
  }

  /** Delete a scheduled queue item after it's been sent. */
  async deleteScheduledItem(kvKey: string): Promise<void> {
    await this.deps.kv.delete(kvKey);
  }

  // ────────────────────────────────────────────────────────────
  // Last scheduled timestamp (for interval calculation)
  // ────────────────────────────────────────────────────────────

  async getLastScheduledTime(channel: string): Promise<number | null> {
    const raw = await this.deps.kv.get(`fredy:sched:last:${channel}`);
    return raw ? Number(raw) : null;
  }

  async setLastScheduledTime(channel: string, timestamp: number): Promise<void> {
    await this.deps.kv.put(`fredy:sched:last:${channel}`, String(timestamp));
  }

  // ────────────────────────────────────────────────────────────
  // Stats reset (admin panel)
  // ────────────────────────────────────────────────────────────

  /** Reset all stats (admin panel "Reset Stats" button). */
  async resetStats(): Promise<void> {
    _statsCache.perAdmin.clear();
    _statsCache.global = { processed: 0, published: 0, rejected: 0, failed: 0, _count: 0 };
    await this.deps.kv.delete("fredy:global:stats");
  }
}

/** Re-export the stat field type for callers. */
export type { StatField as StatFieldType };

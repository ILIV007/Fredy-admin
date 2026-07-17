/**
 * src/services/tick-lock.ts
 * Shared KV-based lock for preventing concurrent tick execution.
 *
 * v8.0.0: Extracted from tick.ts so cron.ts can reuse the same lock.
 * Previously, cron.ts's 24h backup handler called scheduler.tick() with
 * NO lock check — if the external cron and the backup cron fired at the
 * same time, both would run concurrently, causing duplicate posts.
 *
 * Lock key: fredy:tick:lock
 * Lock TTL: configurable (default 90s) — prevents stale locks if a worker dies.
 */

import type { KVStore } from "./kv-store";

const DEFAULT_LOCK_KEY = "fredy:tick:lock";
const DEFAULT_LOCK_TIMEOUT_SEC = 90;

export interface TickLock {
  /** Whether the lock was successfully acquired. */
  readonly acquired: boolean;
  /** Release the lock. Safe to call even if not acquired. */
  readonly release: () => Promise<void>;
}

/**
 * Acquire a KV-based tick lock.
 * Returns { acquired: true, release } on success.
 * Returns { acquired: false, release } if the lock is already held.
 *
 * The lock auto-expires after `timeoutSec` seconds to prevent deadlocks
 * if a worker crashes while holding it.
 */
export async function acquireTickLock(
  kv: KVStore,
  timeoutSec: number = DEFAULT_LOCK_TIMEOUT_SEC,
  lockKey: string = DEFAULT_LOCK_KEY,
): Promise<TickLock> {
  try {
    const existing = await kv.get(lockKey);
    if (existing) {
      return { acquired: false, release: async () => {} };
    }
    // Write the current timestamp so we can inspect when the lock was acquired.
    await kv.set(lockKey, String(Date.now()), timeoutSec);
    return {
      acquired: true,
      release: async () => {
        try {
          await kv.delete(lockKey);
        } catch {
          // Non-fatal — the lock will auto-expire.
        }
      },
    };
  } catch {
    // On KV error, allow execution (better to risk a rare duplicate than
    // to permanently block the scheduler).
    return {
      acquired: true,
      release: async () => {},
    };
  }
}

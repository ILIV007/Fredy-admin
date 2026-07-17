/**
 * src/services/tick-lock.ts
 * Shared distributed lock for scheduler ticks.
 * Both /internal/tick (external cron) and cron.ts (24h backup) use this
 * to prevent concurrent execution.
 */

import type { KVStore } from "./kv-store";

const LOCK_KEY = "fredy:tick:lock";

export interface TickLockResult {
  acquired: boolean;
  release: () => Promise<void>;
}

/** Acquire the tick lock. Returns { acquired, release }.
 *  If lock is held, acquired=false and release is a no-op. */
export async function acquireTickLock(
  kv: KVStore,
  timeoutSec: number,
): Promise<TickLockResult> {
  try {
    const existing = await kv.get(LOCK_KEY);
    if (existing) {
      return { acquired: false, release: async () => {} };
    }
    await kv.set(LOCK_KEY, String(Date.now()), timeoutSec);
    return {
      acquired: true,
      release: async () => {
        try { await kv.delete(LOCK_KEY); } catch { /* non-fatal */ }
      },
    };
  } catch {
    // On KV error, allow execution (better than blocking everything).
    return {
      acquired: true,
      release: async () => {
        try { await kv.delete(LOCK_KEY); } catch { /* non-fatal */ }
      },
    };
  }
}

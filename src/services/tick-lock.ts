/**
 * src/services/tick-lock.ts
 * Shared KV-based lock for preventing concurrent tick execution.
 */
import type { KVStore } from "./kv-store";

const DEFAULT_LOCK_KEY = "fredy:tick:lock";
const DEFAULT_LOCK_TIMEOUT_SEC = 90;

export interface TickLock {
  readonly acquired: boolean;
  readonly release: () => Promise<void>;
}

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
    await kv.set(lockKey, String(Date.now()), timeoutSec);
    return {
      acquired: true,
      release: async () => {
        try { await kv.delete(lockKey); } catch { /* non-fatal */ }
      },
    };
  } catch {
    return { acquired: true, release: async () => {} };
  }
}

/**
 * src/services/tick-lock.ts
 * Shared distributed lock for scheduler ticks.
 */
import type { KVStore } from "./kv-store";
const LOCK_KEY = "fredy:tick:lock";
export interface TickLockResult { acquired: boolean; release: () => Promise<void>; }
export async function acquireTickLock(kv: KVStore, timeoutSec: number): Promise<TickLockResult> {
  try {
    const existing = await kv.get(LOCK_KEY);
    if (existing) return { acquired: false, release: async () => {} };
    await kv.set(LOCK_KEY, String(Date.now()), timeoutSec);
    return { acquired: true, release: async () => { try { await kv.delete(LOCK_KEY); } catch {} } };
  } catch {
    return { acquired: true, release: async () => { try { await kv.delete(LOCK_KEY); } catch {} } };
  }
}

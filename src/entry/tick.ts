/**
 * src/entry/tick.ts
 * Internal tick endpoint — POST/GET /internal/tick
 */

import type { Env, Container } from "../types/env";
import { processScheduledQueue } from "./cron";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import type { Category } from "../types/category";
import type { FredySettings } from "../types/config";

export interface TickHandlerDeps {
  readonly env: Env;
  readonly container: Container;
}

const LOCK_KEY = "fredy:tick:lock";
const LOCK_TIMEOUT_SECONDS = 90;
const REFRESH_KEY = "fredy:tick:lastRefresh";

export async function tickHandler(
  request: Request,
  url: URL,
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container } = deps;
  const startTime = Date.now();
  const log: string[] = [];

  try {
    if (!env.CRON_KEY) return json({ ok: false, error: "CRON_KEY not set" }, 500);
    const authHeader = request.headers.get("Authorization") ?? "";
    const xCronKey = request.headers.get("X-Cron-Key") ?? "";
    const queryKey = url.searchParams.get("key") ?? "";
    const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (xCronKey || queryKey);
    if (providedKey !== env.CRON_KEY) return json({ ok: false, error: "Unauthorized" }, 403);

    const lockAcquired = await acquireLock(container);
    if (!lockAcquired) return json({ ok: true, skipped: true, reason: "lock_held", time: new Date().toISOString(), durationMs: Date.now() - startTime, log: ["skipped: lock held"] });

    try {
      const adminId = env.ADMIN_ID || "0";
      let settings: FredySettings | null = null;
      try {
        settings = await container.config.getSettings(Number(adminId));
      } catch (e) {
        log.push("config error: " + errMsg(e));
      }
      if (!settings) {
        // Try with adminId=0 as fallback, or just return — don't crash.
        return json({ ok: true, time: new Date().toISOString(), durationMs: Date.now() - startTime, log: ["config not available — set ADMIN_ID secret"] });
      }
      log.push("config loaded");

      try {
        await processScheduledQueue(env, container);
        log.push("queue processed");
        const scheduler = new SchedulerOrchestrator(container);
        const tickResult = await scheduler.tick();
        if (tickResult.fired) log.push("slot fired: " + (tickResult.slot?.category ?? "?"));
        else if (tickResult.skipped) log.push("slot skipped: " + (tickResult.skipReason ?? "?"));
        else log.push("no due slots");
      } catch (e) { log.push("publish error: " + errMsg(e)); }

      try { await maintainQueue(container, settings, log); } catch (e) { log.push("queue error: " + errMsg(e)); }
      try { await refreshSourcesIfNeeded(container, settings, log); } catch (e) { log.push("refresh error: " + errMsg(e)); }
      await container.kv.flushAllStats().catch(() => {});
      log.push("done");
    } finally { await releaseLock(container); }

    return json({ ok: true, time: new Date().toISOString(), durationMs: Date.now() - startTime, log });
  } catch (e) {
    return json({ ok: false, error: errMsg(e), time: new Date().toISOString(), durationMs: Date.now() - startTime, log }, 500);
  }
}

async function acquireLock(c: Container): Promise<boolean> {
  try { if (await c.kv.get(LOCK_KEY)) return false; await c.kv.set(LOCK_KEY, String(Date.now()), LOCK_TIMEOUT_SECONDS); return true; } catch { return true; }
}
async function releaseLock(c: Container): Promise<void> { try { await c.kv.delete(LOCK_KEY); } catch {} }

async function maintainQueue(c: Container, s: FredySettings, log: string[]): Promise<void> {
  const cats: Category[] = ["A", "B", "C"];
  const minMap = { A: s.content.queueMinA, B: s.content.queueMinB, C: s.content.queueMinC };
  const tgtMap = { A: s.content.queueTargetA, B: s.content.queueTargetB, C: s.content.queueTargetC };
  for (const cat of cats) {
    if (!s.categories[cat]?.enabled) continue;
    let depth = 0;
    try { depth = await c.queue.depthFor(cat); } catch { continue; }
    if (depth < minMap[cat]) {
      const needed = tgtMap[cat] - depth;
      log.push("queue " + cat + ": " + depth + "/" + minMap[cat] + " gen " + needed);
      for (let i = 0; i < needed; i++) {
        try {
          const r = await c.content.processForCategory(cat, null, s.language.default);
          if (!r.ok) { log.push("  " + cat + " gen failed: " + (r.error || r.rejectedReason)); break; }
        } catch (e) { log.push("  " + cat + " gen error: " + errMsg(e)); break; }
      }
    } else { log.push("queue " + cat + ": " + depth + "/" + minMap[cat] + " OK"); }
  }
}

async function refreshSourcesIfNeeded(c: Container, s: FredySettings, log: string[]): Promise<void> {
  const intervalMs = (s.scheduler.refreshIntervalMinutes || 15) * 60 * 1000;
  let lastRefresh = 0;
  try { const v = await c.kv.get(REFRESH_KEY); lastRefresh = v ? Number(v) : 0; } catch {}
  const now = Date.now();
  if (now - lastRefresh < intervalMs) { log.push("refresh: skipped"); return; }
  let totalDepth = 0;
  try { const d = await c.queue.depth(); totalDepth = d.reduce((sum, x) => sum + x.depth, 0); } catch {}
  if (totalDepth > 20) { log.push("refresh: skipped (queue full)"); return; }
  const scheduler = new SchedulerOrchestrator(c);
  await scheduler.refreshSources();
  await c.kv.set(REFRESH_KEY, String(now));
  log.push("refresh: done");
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function json(obj: unknown, status = 200): Response { return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } }); }

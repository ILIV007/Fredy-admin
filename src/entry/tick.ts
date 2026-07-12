/**
 * src/entry/tick.ts
 * Internal tick endpoint — POST/GET /internal/tick
<<<<<<< HEAD
 *
 * Auth: Authorization: Bearer <CRON_KEY> or X-Cron-Key: <CRON_KEY> or ?key=<CRON_KEY>
 *
 * DESIGN: Non-blocking. Authenticates → acquires lock → returns 200 immediately.
 * All actual work runs in ctx.waitUntil() so external cron-job.org never times out.
 *
 * Pipeline (runs in background):
 *   1. Authenticate (synchronous, fast)
 *   2. Acquire KV lock (prevent concurrent execution)
 *   3. Return 200 OK immediately with "tick started" log
 *   4. [background] Publish due posts
 *   5. [background] Maintain queue (refill if below minimum)
 *   6. [background] Refresh sources (if interval elapsed)
 *   7. [background] Cleanup + release lock
=======
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
 */

import type { Env, Container } from "../types/env";
import { processScheduledQueue } from "./cron";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import type { Category } from "../types/category";
import type { FredySettings } from "../types/config";

export interface TickHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx?: ExecutionContext;
}

const LOCK_KEY = "fredy:tick:lock";
const LOCK_TIMEOUT_SECONDS = 90;
const REFRESH_KEY = "fredy:tick:lastRefresh";
const LAST_TICK_KEY = "fredy:tick:lastTick";
const LAST_LOG_KEY = "fredy:tick:lastLog";

export async function tickHandler(
  request: Request,
  url: URL,
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container, ctx } = deps;
  const startTime = Date.now();

<<<<<<< HEAD
  // ── 1. Authentication (header-based + query fallback) ───
  if (!env.CRON_KEY) {
    return json({ ok: false, error: "CRON_KEY not set" }, 500);
  }
  const authHeader = request.headers.get("Authorization") ?? "";
  const xCronKey = request.headers.get("X-Cron-Key") ?? "";
  const queryKey = url.searchParams.get("key") ?? "";
  const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (xCronKey || queryKey);
  if (providedKey !== env.CRON_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 403);
  }

  // ── 2. Acquire KV lock ──────────────────────────────────
  const lockAcquired = await acquireLock(container);
  if (!lockAcquired) {
    return json({
      ok: true, skipped: true, reason: "lock_held",
      time: new Date().toISOString(), durationMs: Date.now() - startTime,
      log: ["tick skipped: another tick is running"],
    });
  }

  // ── 3. Return 200 immediately and run work in background ───
  const startedAt = new Date().toISOString();
  await container.kv.set(LAST_TICK_KEY, String(Date.now())).catch(() => {});

  // If ctx is available, run in background. Otherwise run synchronously (legacy mode).
  if (ctx) {
    ctx.waitUntil(runTickWork(container, env));
    return json({
      ok: true,
      time: startedAt,
      durationMs: Date.now() - startTime,
      log: ["tick started: running in background"],
    });
  }

  // Fallback: synchronous execution (older Cloudflare environments without ctx)
  const log = await runTickWork(container, env);
  return json({
    ok: true,
    time: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    log,
  });
}

// ────────────────────────────────────────────────────────────
// Background work
// ────────────────────────────────────────────────────────────

async function runTickWork(container: Container, env: Env): Promise<string[]> {
  const log: string[] = [];

  try {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
    log.push("config loaded");

    // ── Publish due posts (from queue only) ────────────
=======
  try {
    if (!env.CRON_KEY) return json({ ok: false, error: "CRON_KEY not set" }, 500);
    const authHeader = request.headers.get("Authorization") ?? "";
    const xCronKey = request.headers.get("X-Cron-Key") ?? "";
    const queryKey = url.searchParams.get("key") ?? "";
    const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (xCronKey || queryKey);
    if (providedKey !== env.CRON_KEY) return json({ ok: false, error: "Unauthorized" }, 403);

    const lockAcquired = await acquireLock(container);
    if (!lockAcquired) return json({ ok: true, skipped: true, reason: "lock_held", time: new Date().toISOString(), durationMs: Date.now() - startTime, log: ["skipped: lock held"] });

>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
    try {
      const adminId = env.ADMIN_ID || "0";
      let settings: FredySettings | null = null;
      try {
        settings = await container.config.getSettings(Number(adminId));
      } catch (e) {
        log.push("config error: " + errMsg(e));
      }
      if (!settings) {
        return json({ ok: true, time: new Date().toISOString(), durationMs: Date.now() - startTime, log });
      }
      log.push("config loaded");

<<<<<<< HEAD
    // ── Maintain queue (refill if below minimum) ──────
    try {
      await maintainQueue(container, settings, log);
    } catch (error) {
      log.push(`queue maintenance error: ${errMsg(error)}`);
    }

    // ── Refresh sources (if interval elapsed) ─────────
    try {
      await refreshSourcesIfNeeded(container, settings, log);
    } catch (error) {
      log.push(`refresh error: ${errMsg(error)}`);
    }

    // ── Cleanup ────────────────────────────────────────
    await container.kv.flushAllStats().catch(() => {});
    log.push("cleanup done");

  } finally {
    // ── Release lock ───────────────────────────────────
    await releaseLock(container);
    // Persist log for debugging
    await container.kv.setJson(LAST_LOG_KEY, { time: Date.now(), log }, 3600).catch(() => {});
  }

  return log;
}

// ────────────────────────────────────────────────────────────
// KV Lock
// ────────────────────────────────────────────────────────────

async function acquireLock(container: Container): Promise<boolean> {
  try {
    const existing = await container.kv.get(LOCK_KEY);
    if (existing) return false; // Lock held.
    await container.kv.set(LOCK_KEY, String(Date.now()), LOCK_TIMEOUT_SECONDS);
    return true;
  } catch {
    return true; // On KV error, allow execution.
=======
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
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
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
<<<<<<< HEAD
    } else {
      log.push(`queue ${cat}: ${depth}/${min} OK`);
    }
=======
    } else { log.push("queue " + cat + ": " + depth + "/" + minMap[cat] + " OK"); }
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
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
<<<<<<< HEAD
  await container.kv.set(REFRESH_KEY, String(now));
  log.push(`refresh: done`);
=======
  await c.kv.set(REFRESH_KEY, String(now));
  log.push("refresh: done");
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function json(obj: unknown, status = 200): Response { return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } }); }

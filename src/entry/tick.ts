/**
 * src/entry/tick.ts
 * Internal tick endpoint — POST/GET /internal/tick
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
 *   4. [background] Stale-tick check (v9.2.2 — see below)
 *   5. [background] Publish due posts
 *   6. [background] Maintain queue (refill if below minimum)
 *   7. [background] Cleanup + release lock
 *
 * v9.2.1: refreshSources() / refreshSourcesIfNeeded() removed — the stub
 * paid a KV write every ~2h for `fredy:tick:lastRefresh` while doing zero
 * work. Source fetching is already covered by content.processForCategory()
 * inside maintainQueue().
 *
 * v9.2.2: Stale-tick detection moved here from cron.ts (no extra trigger).
 * Before overwriting LAST_TICK_KEY, we read its previous value. If the gap
 * exceeds STALE_TICK_GAP_HOURS, a single admin PM is sent and a cooldown
 * timestamp is written so we don't spam. Cost on the happy path: 1 extra
 * KV READ per tick (zero extra writes). The KV-write only happens in the
 * rare case of a real gap (>5h) — once per cooldown window.
 *
 * Detection latency: alerts fire when the service RECOVERS, not at the
 * moment of failure. Worst case: cron-job.org goes down for 3h, comes
 * back, and the admin gets the alert ~3h late. This is acceptable for a
 * free-tier project that values minimal triggers over real-time alerts.
 * For instant failure detection, enable cron-job.org's built-in "alert me
 * if this job doesn't run" feature on their dashboard — zero code, zero KV.
 */

import type { Env, Container } from "../types/env";
import { processScheduledQueue } from "./cron";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import type { Category } from "../types/category";
import type { FredySettings } from "../types/config";
import { acquireTickLock } from "../services/tick-lock";

export interface TickHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx?: ExecutionContext;
}

const LAST_TICK_KEY = "fredy:tick:lastTick";
const LAST_LOG_KEY = "fredy:tick:lastLog";

/** v11.2.0: Stale-tick threshold lowered from 5h to 3h.
 *  The external cron fires every ~2h. A gap >3h means at least 1 cycle was
 *  missed — strong signal something is wrong (cron-job.org down, network
 *  partition, deploy misconfig). Previous 5h threshold was too wide: slots
 *  could be permanently lost (grace=4h) before the alert fired.
 *
 *  v9.2.2: originally 5h.
 *  v11.2.0: lowered to 3h so the alert fires BEFORE grace expires (4h). */
const STALE_TICK_GAP_HOURS = 3;
/** v9.2.2: Cooldown to avoid repeating the alert on every tick after a gap.
 *  Once alerted, subsequent ticks within this window are silent. */
const STALE_TICK_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const STALE_TICK_LAST_ALERT_KEY = "fredy:tick:lastStaleAlert";

export async function tickHandler(
  request: Request,
  url: URL,
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container, ctx } = deps;
  const startTime = Date.now();

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

  // ── 2. Acquire KV lock (timeout from runtime config) ───
  const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
  const lockTimeoutSec = settings?.scheduler?.lockTimeoutSec ?? 90;
  const tickLock = await acquireTickLock(container.kv, lockTimeoutSec);
  if (!tickLock.acquired) {
    return json({
      ok: true, skipped: true, reason: "lock_held",
      time: new Date().toISOString(), durationMs: Date.now() - startTime,
      log: ["tick skipped: another tick is running"],
    });
  }

  // ── 3. Return 200 immediately and run work in background ───
  const startedAt = new Date().toISOString();

  // v9.2.2: Stale-tick check — read the PREVIOUS lastTick BEFORE overwriting.
  // If the gap is unusually long (cron-job.org was down), fire one admin PM.
  // Cost on the happy path: 1 KV READ per tick (no writes). The write + TG
  // send only happen in the rare case of a real gap. Runs in background.
  const previousTickStr = await container.kv.get(LAST_TICK_KEY).catch(() => null);
  const now = Date.now();
  if (ctx && previousTickStr) {
    const previousTick = Number(previousTickStr);
    if (Number.isFinite(previousTick)) {
      const gapHours = (now - previousTick) / (60 * 60 * 1000);
      if (gapHours > STALE_TICK_GAP_HOURS) {
        ctx.waitUntil(notifyStaleTick(env, container, gapHours, previousTick, now));
      }
    }
  }
  // Now safe to overwrite with the current tick timestamp.
  await container.kv.set(LAST_TICK_KEY, String(now)).catch(() => {});

  // If ctx is available, run in background. Otherwise run synchronously (legacy mode).
  if (ctx) {
    ctx.waitUntil(runTickWork(container, env, tickLock));
    return json({
      ok: true,
      time: startedAt,
      durationMs: Date.now() - startTime,
      log: ["tick started: running in background"],
    });
  }

  // Fallback: synchronous execution (older Cloudflare environments without ctx)
  const log = await runTickWork(container, env, tickLock);
  return json({
    ok: true,
    time: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    log,
  });
}

// ────────────────────────────────────────────────────────────
// v9.2.2: Stale-tick notification (background)
// ────────────────────────────────────────────────────────────

/** Send a single admin PM if the gap since the last tick exceeds the threshold.
 *  Suppresses repeats within STALE_TICK_ALERT_COOLDOWN_MS via a KV cooldown key. */
async function notifyStaleTick(
  env: Env,
  container: Container,
  gapHours: number,
  previousTick: number,
  currentTick: number,
): Promise<void> {
  try {
    // Check cooldown to avoid spamming the admin on every tick after a gap.
    const lastAlertStr = await container.kv.get(STALE_TICK_LAST_ALERT_KEY).catch(() => null);
    const lastAlert = lastAlertStr ? Number(lastAlertStr) : 0;
    if (lastAlert && currentTick - lastAlert < STALE_TICK_ALERT_COOLDOWN_MS) {
      return; // Already alerted recently — suppress.
    }

    const adminId = Number(env.ADMIN_ID ?? "0");
    if (adminId > 0) {
      await container.tg.sendMessage(
        adminId,
        [
          ``,
          `<b>━━━ ⚠️ STALE TICK ALERT ━━━</b>`,
          ``,
          ``,
          `<blockquote>⏰ <b>Gap since last tick:</b> ${gapHours.toFixed(1)} hours</blockquote>`,
          `<blockquote>🕐 <b>Last tick:</b> ${new Date(previousTick).toISOString()}</blockquote>`,
          `<blockquote>🔄 <b>This tick:</b> ${new Date(currentTick).toISOString()}</blockquote>`,
          `<blockquote>💡 <b>External cron (cron-job.org) may have been down.</b></blockquote>`,
        ].join("\n"),
        { parse_mode: "HTML" },
      ).catch(() => {});
    }
    // Record the alert time so we don't spam.
    await container.kv.set(STALE_TICK_LAST_ALERT_KEY, String(currentTick), 24 * 60 * 60).catch(() => {});
  } catch (error) {
    console.error("[tick] stale-tick notification failed:", error instanceof Error ? error.message : error);
  }
}

// ────────────────────────────────────────────────────────────
// Background work
// ────────────────────────────────────────────────────────────

async function runTickWork(container: Container, env: Env, tickLock: { release: () => Promise<void> }): Promise<string[]> {
  const log: string[] = [];

  try {
    // v8.1.1: Settings are already cached by ConfigCache (module-level singleton),
    // so this is an in-memory hit, not a KV read.
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
    log.push("config loaded");

    // ════════════════════════════════════════════════════════════
    // v11.5.0: CRITICAL FIX — Scheduler.tick() runs FIRST!
    //
    // Previously (v11.1.0–v11.4.0), providerEngine.refreshDueProviders(3)
    // ran FIRST and could take 15-45 seconds. Cloudflare Workers Free Plan
    // has a 30s wall time limit for ctx.waitUntil(). The Worker would be
    // killed BEFORE scheduler.tick() ever ran, so scheduled posts were
    // NEVER published automatically.
    //
    // Now the order is:
    //   1. Scheduler tick (fire due slots) — CRITICAL, must run first
    //   2. Process scheduled queue (silent scheduling fallback)
    //   3. Maintain queue (refill if below minimum)
    //   4. Provider engine refresh (staggered, for NEXT tick)
    // ════════════════════════════════════════════════════════════

    // ── 1. SCHEDULER TICK — fire due slots (CRITICAL) ────
    try {
      // Process silent scheduling queue first (Telegram schedule_date fallback).
      await processScheduledQueue(env, container);
      log.push("scheduled queue processed");

      // Scheduler tick — fires ALL due slots from the daily plan.
      const scheduler = new SchedulerOrchestrator(container);
      const tickResult = await scheduler.tick();
      if (tickResult.fired) {
        log.push(`✅ slot fired: category=${tickResult.slot?.category ?? "?"}`);
      } else if (tickResult.skipped) {
        log.push(`⚠️ slot skipped: ${tickResult.skipReason ?? "unknown"}`);
      } else {
        log.push("no due slots");
      }
    } catch (error) {
      log.push(`❌ publish error: ${errMsg(error)}`);
    }

    // ── 2. MAINTAIN QUEUE (refill if below minimum) ────
    try {
      await maintainQueue(container, settings, log);
    } catch (error) {
      log.push(`queue maintenance error: ${errMsg(error)}`);
    }

    // ── 3. PROVIDER ENGINE REFRESH (for NEXT tick) ────
    // v11.5.0: Moved to LAST — this is the least time-sensitive operation.
    // It refreshes provider caches for the NEXT tick, not the current one.
    // If the Worker runs out of time, this is safely skipped.
    try {
      const refreshResult = await container.providerEngine.refreshDueProviders(2);
      if (refreshResult.refreshed.length > 0) {
        log.push(`providers refreshed: ${refreshResult.refreshed.join(", ")}`);
      }
      if (refreshResult.skipped.length > 0) {
        log.push(`providers skipped: ${refreshResult.skipped.join(", ")}`);
      }
      if (refreshResult.failed.length > 0) {
        log.push(`providers failed: ${refreshResult.failed.join(", ")}`);
      }
      if (refreshResult.refreshed.length === 0 && refreshResult.skipped.length === 0 && refreshResult.failed.length === 0) {
        log.push("no providers due for refresh");
      }
    } catch (error) {
      log.push(`provider engine error: ${errMsg(error)}`);
    }

    // ── Cleanup ────────────────────────────────────────
    await container.kv.flushAllStats().catch(() => {});
    log.push("cleanup done");

  } finally {
    // ── Release lock ───────────────────────────────────
    await tickLock.release();
    // Persist log for debugging
    await container.kv.setJson(LAST_LOG_KEY, { time: Date.now(), log }, 3600).catch(() => {});
  }

  return log;
}

// ────────────────────────────────────────────────────────────
// Queue Maintenance (smart refill)
// ────────────────────────────────────────────────────────────

async function maintainQueue(
  container: Container,
  settings: FredySettings,
  log: string[],
): Promise<void> {
  const categories: Category[] = ["A", "B", "C"];
  const minMap: Record<Category, number> = {
    A: settings.content.queueMinA,
    B: settings.content.queueMinB,
    C: settings.content.queueMinC,
  };
  const targetMap: Record<Category, number> = {
    A: settings.content.queueTargetA,
    B: settings.content.queueTargetB,
    C: settings.content.queueTargetC,
  };

  // v8.1.1: Batch depth checks — use depth() once instead of depthFor() per category.
  // This reduces 3 KV reads to 1.
  const allDepths = await container.queue.depth();
  const depthMap: Record<string, number> = {};
  for (const d of allDepths) {
    depthMap[d.category] = d.depth;
  }

  for (const cat of categories) {
    if (!settings.categories[cat].enabled) continue;

    const depth = depthMap[cat] ?? 0;
    const min = minMap[cat];
    const target = targetMap[cat];

    if (depth < min) {
      const needed = target - depth;
      log.push(`queue ${cat}: ${depth}/${min} — generating ${needed} items`);

      // Generate content to fill the queue.
      for (let i = 0; i < needed; i++) {
        try {
          const result = await container.content.processForCategory(cat, null, settings.language.default);
          if (result.ok) {
            log.push(`  ${cat}: generated ${result.content?.id ?? "?"}`);
          } else {
            log.push(`  ${cat}: generation failed — ${result.error ?? result.rejectedReason ?? "unknown"}`);
            break; // Stop if generation fails (likely no more content).
          }
        } catch (error) {
          log.push(`  ${cat}: generation error — ${errMsg(error)}`);
          break;
        }
      }
    } else {
      log.push(`queue ${cat}: ${depth}/${min} OK`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

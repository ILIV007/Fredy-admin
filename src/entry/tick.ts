/**
 * src/entry/tick.ts
 * v12.0.0 — Manual Tick Endpoint (POST/GET /internal/tick)
 *
 * This endpoint is retained for backward compatibility with cron-job.org
 * and for manual triggering from the dashboard. In the v12.0.0 architecture,
 * Cloudflare's internal cron triggers handle the three layers automatically:
 *
 *   Layer 1 (every 20 min)  →  Scheduler Watcher  →  cron-scheduler.ts
 *   Layer 2 (every 2h)      →  Provider Refresh    →  cron-providers.ts
 *   Layer 3 (every 24h)     →  Daily Maintenance   →  cron-maintenance.ts
 *
 * This endpoint runs Layer 1 by default. Add ?full=true to run all three
 * layers sequentially (useful for manual debugging / dashboard "Force Tick").
 *
 * Auth: Authorization: Bearer <CRON_KEY> or X-Cron-Key: <CRON_KEY> or ?key=<CRON_KEY>
 *
 * DESIGN: Non-blocking. Authenticates → acquires lock → returns 200 immediately.
 * All actual work runs in ctx.waitUntil() so external callers never time out.
 */

import type { Env, Container } from "../types/env";
import { processScheduledQueue } from "./cron";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import type { FredySettings } from "../types/config";
import { acquireTickLock } from "../services/tick-lock";

export interface TickHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx?: ExecutionContext;
}

const LAST_TICK_KEY = "fredy:tick:lastTick";
const LAST_LOG_KEY = "fredy:tick:lastLog";

/** v11.2.0: Stale-tick threshold — lowered from 5h to 3h. */
const STALE_TICK_GAP_HOURS = 3;
/** v9.2.2: Cooldown to avoid repeating the alert on every tick after a gap. */
const STALE_TICK_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STALE_TICK_LAST_ALERT_KEY = "fredy:tick:lastStaleAlert";

export async function tickHandler(
  request: Request,
  url: URL,
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container, ctx } = deps;
  const startTime = Date.now();

  // ── 1. Authentication ───
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

  // v12.0.0: ?full=true runs all three layers (manual debugging).
  const fullMode = url.searchParams.get("full") === "true";

  // ── 2. Acquire KV lock ───
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

  // Stale-tick check — read the PREVIOUS lastTick BEFORE overwriting.
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
  await container.kv.set(LAST_TICK_KEY, String(now)).catch(() => {});

  if (ctx) {
    ctx.waitUntil(runTickWork(container, env, tickLock, settings, now, fullMode));
    return json({
      ok: true,
      mode: fullMode ? "full" : "scheduler-watch",
      time: startedAt,
      durationMs: Date.now() - startTime,
      log: ["tick started: running in background"],
    });
  }

  // Fallback: synchronous execution (older environments without ctx)
  const log = await runTickWork(container, env, tickLock, settings, now, fullMode);
  return json({
    ok: true,
    mode: fullMode ? "full" : "scheduler-watch",
    time: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    log,
  });
}

// ────────────────────────────────────────────────────────────
// Stale-tick notification (background)
// ────────────────────────────────────────────────────────────

async function notifyStaleTick(
  env: Env,
  container: Container,
  gapHours: number,
  previousTick: number,
  currentTick: number,
): Promise<void> {
  try {
    const lastAlertStr = await container.kv.get(STALE_TICK_LAST_ALERT_KEY).catch(() => null);
    const lastAlert = lastAlertStr ? Number(lastAlertStr) : 0;
    if (lastAlert && currentTick - lastAlert < STALE_TICK_ALERT_COOLDOWN_MS) {
      return;
    }

    const adminId = Number(env.ADMIN_ID ?? "0");
    if (adminId > 0) {
      await container.tg.sendMessage(
        adminId,
        [
          ``,
          `<b>━━━ ⚠️ STALE TICK ALERT ━━━</b>`,
          ``,
          `<blockquote>⏰ <b>Gap since last tick:</b> ${gapHours.toFixed(1)} hours</blockquote>`,
          `<blockquote>🕐 <b>Last tick:</b> ${new Date(previousTick).toISOString()}</blockquote>`,
          `<blockquote>🔄 <b>This tick:</b> ${new Date(currentTick).toISOString()}</blockquote>`,
          `<blockquote>💡 <b>Cloudflare cron may have missed cycles.</b></blockquote>`,
        ].join("\n"),
        { parse_mode: "HTML" },
      ).catch(() => {});
    }
    await container.kv.set(STALE_TICK_LAST_ALERT_KEY, String(currentTick), 24 * 60 * 60).catch(() => {});
  } catch (error) {
    console.error("[tick] stale-tick notification failed:", error instanceof Error ? error.message : error);
  }
}

// ────────────────────────────────────────────────────────────
// Background work
// ────────────────────────────────────────────────────────────

/**
 * v12.0.0: Tick work — runs Layer 1 (scheduler watch) by default.
 * If fullMode is true, also runs Layer 2 (provider refresh) + queue maintenance.
 * Layer 3 (daily maintenance) is NOT run here — it's too heavy and only
 * runs once per day via the 24h cron.
 */
async function runTickWork(
  container: Container,
  env: Env,
  tickLock: { release: () => Promise<void> },
  cachedSettings: FredySettings | null,
  tickStartTime: number,
  fullMode: boolean,
): Promise<string[]> {
  const log: string[] = [];

  try {
    const settings = cachedSettings ?? await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
    log.push(`config loaded (mode: ${fullMode ? "full" : "scheduler-watch"})`);

    // ════════════════════════════════════════════════════════════
    // Layer 1: SCHEDULER WATCH — fire due slots (ALWAYS runs)
    // ════════════════════════════════════════════════════════════
    try {
      await processScheduledQueue(env, container);
      log.push("scheduled queue processed");

      const scheduler = new SchedulerOrchestrator(container);
      const tickResult = await scheduler.tick();
      if (tickResult.fired) {
        log.push(`✅ slot fired: #${tickResult.slot?.index} scheduled=${tickResult.slot?.scheduledTime ?? tickResult.slot?.time} cat=${tickResult.slot?.category ?? "?"}`);
      } else if (tickResult.skipped) {
        log.push(`⚠️ slot skipped: ${tickResult.skipReason ?? "unknown"}`);
      } else {
        log.push("no due slots");
      }
    } catch (error) {
      log.push(`❌ publish error: ${errMsg(error)}`);
    }

    // ════════════════════════════════════════════════════════════
    // Layer 2: PROVIDER REFRESH + QUEUE MAINTENANCE (only in full mode)
    // ════════════════════════════════════════════════════════════
    if (fullMode) {
      try {
        await maintainQueue(container, settings, log);
      } catch (error) {
        log.push(`queue maintenance error: ${errMsg(error)}`);
      }

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
    }

    // ── Cleanup ────
    await container.kv.flushAllStats().catch(() => {});
    log.push("cleanup done");

  } finally {
    await tickLock.release();
    await container.kv.setJson(LAST_LOG_KEY, {
      time: Date.now(),
      tickTime: tickStartTime,
      layer: fullMode ? "manual-full" : "manual-scheduler-watch",
      durationMs: Date.now() - tickStartTime,
      log,
    }, 3600).catch(() => {});
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
  const categories: import("../types/category").Category[] = ["A", "B", "C"];
  const minMap: Record<import("../types/category").Category, number> = {
    A: settings.content.queueMinA,
    B: settings.content.queueMinB,
    C: settings.content.queueMinC,
  };
  const targetMap: Record<import("../types/category").Category, number> = {
    A: settings.content.queueTargetA,
    B: settings.content.queueTargetB,
    C: settings.content.queueTargetC,
  };

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

      for (let i = 0; i < needed; i++) {
        try {
          const result = await container.content.processForCategory(cat, null, settings.language.default);
          if (result.ok) {
            log.push(`  ${cat}: generated ${result.content?.id ?? "?"}`);
          } else {
            log.push(`  ${cat}: generation failed — ${result.error ?? result.rejectedReason ?? "unknown"}`);
            break;
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

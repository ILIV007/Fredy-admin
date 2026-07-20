/**
 * src/entry/cron-scheduler.ts
 * v12.0.2 — Layer 1: Scheduler Watcher Cron (every 20 minutes).
 *
 * This is the PRIMARY publishing trigger. It runs on Cloudflare's
 * internal cron (every 20 minutes) and does ONE thing: check if any
 * pending post's `scheduledTime` has been reached, and if so,
 * publish it.
 *
 * DESIGN PHILOSOPHY — "Watcher, not Engine":
 *   The 20-minute cron is a lightweight WATCHER. On the happy path
 *   (no post due), it performs exactly 1 KV read (the daily plan)
 *   and 0 KV writes. It does NOT:
 *     ❌ Refresh providers
 *     ❌ Maintain the content queue
 *     ❌ Call Gemini / AI
 *     ❌ Resolve images
 *     ❌ Generate new plans
 *
 * v12.0.2 — ZERO-KV QUIET HOURS:
 *   Cloudflare Cron cannot be dynamically disabled — the trigger
 *   fires every 20 minutes regardless. But during quiet hours
 *   (default 00:00–07:30 Asia/Tehran), NO post can publish and
 *   NO posting window is active. Waking up to do nothing is wasteful.
 *
 *   The guard checks quiet hours FIRST, before any KV operation:
 *     1. Read settings (cached in isolate — usually free)
 *     2. Check isQuietHours(now, config) — pure, no KV
 *     3. If quiet → console.log a diagnostic ONLY + RETURN
 *        (0 KV reads, 0 KV writes, 0 provider calls)
 *     4. If not quiet → normal Layer 1 flow
 *
 *   v12.0.2 change: Removed QUIET_SKIP_KEY KV write entirely.
 *   Quiet hours now consume ZERO KV operations. The dashboard
 *   computes quiet-hours status live from settings + current time
 *   (no stored marker needed).
 *
 *   IMPORTANT: This guard applies ONLY to automatic cron execution.
 *   Manual force-publish (Manager → Force Publish) calls
 *   content.processForCategory + finalPublisher.publish directly,
 *   bypassing this cron entirely. Manual publish still works during
 *   quiet hours.
 *
 * RANDOM JITTER — the real trigger (v12.0.2: EXACT):
 *   Each daily-plan slot has a `scheduledTime` (e.g., "17:24") that
 *   was randomly generated within its posting window (e.g., 16:00-18:00).
 *   The watcher fires when:
 *     now >= scheduledTime        (EXACT — no tolerance, v12.0.2)
 *     AND now < windowEnd + 6h    (expiry guard)
 *
 *   With a 20-min cron, the actual publish lands on the first tick
 *   AT OR AFTER scheduledTime (0-20 min delay). This is the real jitter.
 *
 * CONCURRENCY:
 *   Cloudflare cron triggers are sequential. Double-publish protection
 *   comes from the `markPostPublishing()` status marker plus 3-layer
 *   dedup (canonical ID + URL + hash).
 *
 * KV USAGE (per 20-min tick):
 *   Quiet-hours path:  0 reads + 0 writes  ← v12.0.2 ZERO-KV
 *   No-due path:       1 read (plan) + 0 writes
 *   Due path:          ~8 reads + ~6 writes (dedup + history + mark)
 *
 * See V12_ARCHITECTURE.md §3 and V12.0.2_PATCH.md for details.
 */

import type { Env, Container } from "../types/env";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import { processScheduledQueue } from "./cron";

const LAST_LOG_KEY = "fredy:tick:lastLog";
const LAST_TICK_KEY = "fredy:tick:lastTick";
// v12.0.2: QUIET_SKIP_KEY removed — quiet hours now consume ZERO KV ops.

export interface CronSchedulerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

/**
 * Layer 1 handler — invoked by Cloudflare cron (every 20 minutes).
 * Runs entirely in ctx.waitUntil() so the cron event returns fast.
 */
export async function cronSchedulerHandler(deps: CronSchedulerDeps): Promise<void> {
  const { env, container, ctx } = deps;
  ctx.waitUntil(runSchedulerWatch(container, env));
}

/**
 * The core watch logic. Designed to be cheap on the no-due path.
 *
 * v12.0.2 Flow:
 *   0. Read settings (cached in isolate)
 *   0a. If scheduler disabled → return (0 writes)
 *   0b. If maintenance mode → return (0 writes)
 *   0c. **QUIET HOURS CHECK** — if quiet → console.log ONLY + return (0 KV ops)
 *   1. Process silent scheduling fallback queue (Telegram schedule_date)
 *   2. Call scheduler.tick() — internally:
 *      a. Read daily plan (1 KV read)
 *      b. findDueSlot() — EXACT scheduledTime check (v12.0.2: no tolerance)
 *      c. If no due slot → return (0 writes on this path!)
 *      d. If due slot → markPostPublishing → publish → markPublished
 *   3. Write lastLog ONLY if work was done (keeps no-due path at 0 writes)
 */
async function runSchedulerWatch(container: Container, env: Env): Promise<void> {
  const startTime = Date.now();
  const log: string[] = [];
  let didWork = false;

  try {
    // ── 0. Load settings (cached in isolate — usually free after first call) ────
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    if (!settings) {
      // Can't read settings — can't check quiet hours. Run normally as a fallback.
      log.push("settings load failed — running without quiet-hours guard");
    } else {
      // 0a. Bail out early if scheduler is disabled.
      if (!settings.scheduler.enabled) {
        return; // 0 KV writes
      }
      // 0b. Bail out during maintenance mode.
      if (settings.general.maintenanceMode) {
        return; // 0 KV writes
      }

      // ════════════════════════════════════════════════════════════
      // 0c. v12.0.2: ZERO-KV QUIET HOURS GUARD
      // ════════════════════════════════════════════════════════════
      // Check quiet hours BEFORE any KV-heavy operation. During quiet
      // hours (default 00:00-07:30), no post can publish and no window
      // is active, so we skip ALL KV operations:
      //   - processScheduledQueue (1+ KV reads)
      //   - scheduler.tick() (1 plan read + potential writes)
      //   - stats flush
      //
      // v12.0.2: NO KV writes either — not even a skip marker.
      // The dashboard computes quiet-hours status live from settings +
      // current time (cronOptimization.currentState). No stored marker.
      //
      // The QuietHoursChecker handles midnight-crossing periods
      // (e.g., 23:00-07:30) correctly.
      const isQuiet = container.quietHoursChecker?.isQuietHours(startTime, settings.scheduler) ?? false;
      if (isQuiet) {
        const tz = settings.scheduler.timezone || "UTC";
        const localTime = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date(startTime));
        const qh = settings.scheduler.quietHours;

        // Lightweight runtime log (console ONLY — zero KV ops).
        console.log(JSON.stringify({
          layer: "scheduler-watcher",
          status: "skipped",
          reason: "quiet_hours",
          timezone: tz,
          localTime,
          quietHours: qh ? `${qh.start}-${qh.end}` : null,
        }));

        return; // 0 KV reads, 0 KV writes — zero-KV quiet hours!
      }
    }

    // ── 1. Process the silent scheduling fallback queue (Telegram schedule_date) ────
    //    This catches messages Telegram failed to schedule natively.
    //    Skipped during quiet hours (above) — no point checking during sleep.
    await processScheduledQueue(env, container);

    // ── 2. Run the scheduler tick — the heart of the watcher ────
    const scheduler = new SchedulerOrchestrator(container);
    const result = await scheduler.tick();

    if (result.fired) {
      didWork = true;
      log.push(`✅ published: slot #${result.slot?.index ?? "?"} scheduled=${result.slot?.scheduledTime ?? result.slot?.time ?? "?"} cat=${result.slot?.category ?? "?"}`);
    } else if (result.skipped && result.skipReason && result.skipReason !== "No due slots") {
      log.push(`⚠️ skipped: ${result.skipReason}`);
      didWork = true; // Log non-trivial skips.
    }
    // "No due slots" is the normal case — silent, no log entry, no KV write.

    // ── 3. Flush batched stats if we published ────
    if (result.fired) {
      await container.kv.flushAllStats().catch(() => {});
    }

  } catch (error) {
    didWork = true;
    log.push(`❌ scheduler-watch error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── 4. Only write lastLog/lastTick if we actually did work ────
  //    This keeps the no-due path at 0 KV writes — the key optimization.
  if (didWork) {
    await container.kv.set(LAST_TICK_KEY, String(startTime)).catch(() => {});
    await container.kv.setJson(LAST_LOG_KEY, {
      time: Date.now(),
      tickTime: startTime,
      layer: "scheduler-watch",
      durationMs: Date.now() - startTime,
      log,
    }, 3600).catch(() => {});
  }
}

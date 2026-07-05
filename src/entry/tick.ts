/**
 * src/entry/tick.ts
 * External cron endpoint — optimized for minimal KV usage.
 *
 * Usage:
 *   GET https://<worker-url>/tick?key=<CRON_KEY>
 *
 * Recommended: call every 5 minutes (not every minute).
 * Slots are at specific times with ±30 min jitter, so 5-min
 * resolution is more than enough.
 *
 * Optimizations:
 *   1. Early-exit: if no slot is due within the next 5 minutes,
 *      return immediately without processing.
 *   2. Source refresh: only when queue depth is low (< 2 items
 *      in any enabled category).
 *   3. Scheduled queue: only checks if items exist (fast KV list).
 */

import type { Env, Container } from "../types/env";
import { processScheduledQueue } from "./cron";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import { slotsKey } from "../core/storage/keys";
import { formatDateInZone } from "../primitives/time";

export interface TickHandlerDeps {
  readonly env: Env;
  readonly container: Container;
}

/** How far ahead to look for due slots (ms). */
const LOOK_AHEAD_MS = 5 * 60 * 1000; // 5 minutes

export async function tickHandler(
  request: Request,
  url: URL,
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container } = deps;

  // Auth check.
  if (!env.CRON_KEY) {
    return json({ ok: false, error: "CRON_KEY not set" }, 500);
  }
  const key = url.searchParams.get("key");
  if (key !== env.CRON_KEY) {
    return json({ ok: false, error: "Invalid key" }, 403);
  }

  const startTime = Date.now();
  const now = Date.now();
  const log: string[] = [];

  // ── 1. Fast check: is any slot due now or within next 5 min? ──
  const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
  const timezone = settings.scheduler.timezone;
  const today = formatDateInZone(now, timezone);

  // Read today's plan (1 KV read — cached after first load).
  const plan = await container.kv.getJson<{
    slots: Array<{ epochMs: number; fired?: boolean }>;
  }>(slotsKey(today));

  if (plan && plan.slots) {
    // Check if any unfired slot is due now or within LOOK_AHEAD_MS.
    let hasDueSlot = false;
    for (const slot of plan.slots) {
      if (slot.epochMs <= now + LOOK_AHEAD_MS) {
        // Check if already fired (1 KV read per due slot — but only for due ones).
        const firedKey = `fredy:sched:sent:${today}:${plan.slots.indexOf(slot)}`;
        const fired = await container.kv.get(firedKey);
        if (!fired) {
          hasDueSlot = true;
          break;
        }
      }
    }

    if (!hasDueSlot) {
      // No slot due — skip everything, return immediately.
      // Total KV reads: 1 (plan) + 0-1 (fired check) = 1-2 reads.
      return json({
        ok: true,
        time: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        skipped: true,
        reason: "no_due_slots",
        log: ["early exit: no slots due"],
      });
    }
  }

  // ── 2. Process scheduled queue (fast KV list — only reads keys). ──
  try {
    await processScheduledQueue(env, container);
    log.push("scheduled queue checked");
  } catch (error) {
    log.push(`queue error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── 3. Scheduler tick (fires due slots). ──
  let tickResult = null;
  try {
    const scheduler = new SchedulerOrchestrator(container);
    tickResult = await scheduler.tick();
    if (tickResult.fired) {
      log.push(`slot fired: category=${tickResult.slot?.category ?? "?"}`);
    } else if (tickResult.skipped) {
      log.push(`slot skipped: ${tickResult.skipReason ?? "unknown"}`);
    }
  } catch (error) {
    log.push(`scheduler error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── 4. Source refresh — only if queue is low (every 15 min + low depth). ──
  const minute = new Date().getMinutes();
  if (minute % 15 === 0) {
    try {
      const depths = await container.content.queue.depth?.() ?? 
        await container.queue.depth();
      const totalDepth = depths.reduce((sum: number, d: { depth: number }) => sum + d.depth, 0);
      
      if (totalDepth < 3) {
        const scheduler = new SchedulerOrchestrator(container);
        await scheduler.refreshSources();
        log.push(`source refresh (queue depth: ${totalDepth})`);
      } else {
        log.push(`source refresh skipped (queue depth: ${totalDepth})`);
      }
    } catch {
      // Non-critical — skip.
    }
  }

  const durationMs = Date.now() - startTime;

  return json({
    ok: true,
    time: new Date().toISOString(),
    durationMs,
    fired: tickResult?.fired ?? false,
    skipped: tickResult?.skipped ?? false,
    log,
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

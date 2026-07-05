/**
 * src/entry/tick.ts
 * External cron endpoint — replaces Cloudflare Cron Triggers.
 *
 * Usage:
 *   GET https://<worker-url>/tick?key=<CRON_KEY>
 *
 * Set up an external cron service (cron-job.org, GitHub Actions,
 * uptimerobot, etc.) to hit this URL every minute.
 *
 * The endpoint runs:
 *   1. Scheduler tick (fire due slots)
 *   2. Source refresh (every 15th minute)
 *   3. Scheduled queue processing
 */

import type { Env, Container } from "../types/env";
import { processScheduledQueue } from "./cron";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";

export interface TickHandlerDeps {
  readonly env: Env;
  readonly container: Container;
}

export async function tickHandler(
  request: Request,
  url: URL,
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container } = deps;

  // Auth check — CRON_KEY must be set and match.
  if (!env.CRON_KEY) {
    return json({ ok: false, error: "CRON_KEY not set" }, 500);
  }

  const key = url.searchParams.get("key");
  if (key !== env.CRON_KEY) {
    return json({ ok: false, error: "Invalid key" }, 403);
  }

  const startTime = Date.now();
  const log: string[] = [];

  // 1. Process scheduled queue (silent fallback).
  try {
    await processScheduledQueue(env, container);
    log.push("scheduled queue processed");
  } catch (error) {
    log.push(`scheduled queue error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Scheduler tick.
  let tickResult = null;
  try {
    const scheduler = new SchedulerOrchestrator(container);
    tickResult = await scheduler.tick();
    if (tickResult.fired) {
      log.push(`slot fired: index=${tickResult.slot?.index ?? "?"} category=${tickResult.slot?.category ?? "?"}`);
    } else if (tickResult.skipped) {
      log.push(`slot skipped: ${tickResult.skipReason ?? "unknown"}`);
    } else {
      log.push("no due slots");
    }

    // 3. Source refresh (every 15th minute).
    const minute = new Date().getMinutes();
    if (minute % 15 === 0) {
      await scheduler.refreshSources();
      log.push("source refresh complete");
    }
  } catch (error) {
    log.push(`scheduler error: ${error instanceof Error ? error.message : String(error)}`);
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

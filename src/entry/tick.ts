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
 *   4. [background] Publish due posts
 *   5. [background] Maintain queue (refill if below minimum)
 *   6. [background] Cleanup + release lock
 *
 * v9.2.1: refreshSources() / refreshSourcesIfNeeded() removed — the stub
 * paid a KV write every ~2h for `fredy:tick:lastRefresh` while doing zero
 * work. Source fetching is already covered by content.processForCategory()
 * inside maintainQueue().
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
  await container.kv.set(LAST_TICK_KEY, String(Date.now())).catch(() => {});

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
// Background work
// ────────────────────────────────────────────────────────────

async function runTickWork(container: Container, env: Env, tickLock: { release: () => Promise<void> }): Promise<string[]> {
  const log: string[] = [];

  try {
    // v8.1.1: Settings are already cached by ConfigCache (module-level singleton),
    // so this is an in-memory hit, not a KV read.
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
    log.push("config loaded");

    // ── Publish due posts (from queue only) ────────────
    try {
      // Process silent scheduling queue.
      await processScheduledQueue(env, container);
      log.push("scheduled queue processed");

      // Scheduler tick — fires due slots from queue.
      const scheduler = new SchedulerOrchestrator(container);
      const tickResult = await scheduler.tick();
      if (tickResult.fired) {
        log.push(`slot fired: category=${tickResult.slot?.category ?? "?"}`);
      } else if (tickResult.skipped) {
        log.push(`slot skipped: ${tickResult.skipReason ?? "unknown"}`);
      } else {
        log.push("no due slots");
      }
    } catch (error) {
      log.push(`publish error: ${errMsg(error)}`);
    }

    // ── Maintain queue (refill if below minimum) ──────
    try {
      await maintainQueue(container, settings, log);
    } catch (error) {
      log.push(`queue maintenance error: ${errMsg(error)}`);
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

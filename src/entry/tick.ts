/**
 * src/entry/tick.ts
 * Internal tick endpoint — POST /internal/tick
 *
 * Auth: Authorization: Bearer <CRON_KEY> or X-Cron-Key: <CRON_KEY>
 *
 * Pipeline:
 *   1. Authenticate (header-based)
 *   2. Acquire KV lock (prevent concurrent execution)
 *   3. Load runtime config
 *   4. Publish due posts (from queue only)
 *   5. Maintain queue (refill if below minimum)
 *   6. Refresh sources (if interval elapsed)
 *   7. Cleanup
 *   8. Release lock
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
  deps: TickHandlerDeps,
): Promise<Response> {
  const { env, container } = deps;
  const startTime = Date.now();
  const log: string[] = [];

  // ── 1. Authentication (header-based) ─────────────────────
  if (!env.CRON_KEY) {
    return json({ ok: false, error: "CRON_KEY not set" }, 500);
  }
  const authHeader = request.headers.get("Authorization") ?? "";
  const xCronKey = request.headers.get("X-Cron-Key") ?? "";
  const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xCronKey;
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

  try {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));

    // ── 3. Load runtime config ────────────────────────────
    log.push("config loaded");

    // ── 4. Publish due posts (from queue only) ────────────
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

    // ── 5. Maintain queue (refill if below minimum) ──────
    try {
      await maintainQueue(container, settings, log);
    } catch (error) {
      log.push(`queue maintenance error: ${errMsg(error)}`);
    }

    // ── 6. Refresh sources (if interval elapsed) ─────────
    try {
      await refreshSourcesIfNeeded(container, settings, log);
    } catch (error) {
      log.push(`refresh error: ${errMsg(error)}`);
    }

    // ── 7. Cleanup ────────────────────────────────────────
    // Flush batched stats.
    await container.kv.flushAllStats().catch(() => {});
    log.push("cleanup done");

  } finally {
    // ── 8. Release lock ───────────────────────────────────
    await releaseLock(container);
  }

  return json({
    ok: true,
    time: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    log,
  });
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
  }
}

async function releaseLock(container: Container): Promise<void> {
  try {
    await container.kv.delete(LOCK_KEY);
  } catch {
    // ignore
  }
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

  for (const cat of categories) {
    if (!settings.categories[cat].enabled) continue;

    const depth = await container.queue.depthFor(cat);
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
      log.push(`queue ${cat}: ${depth}/${min} — OK`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// Source Refresh (interval-based)
// ────────────────────────────────────────────────────────────

async function refreshSourcesIfNeeded(
  container: Container,
  settings: FredySettings,
  log: string[],
): Promise<void> {
  const intervalMs = settings.scheduler.refreshIntervalMinutes * 60 * 1000;
  const lastRefreshStr = await container.kv.get(REFRESH_KEY);
  const lastRefresh = lastRefreshStr ? Number(lastRefreshStr) : 0;
  const now = Date.now();

  if (now - lastRefresh < intervalMs) {
    const remaining = Math.ceil((intervalMs - (now - lastRefresh)) / 60000);
    log.push(`source refresh: skipped (${remaining}min until next)`);
    return;
  }

  // Check if refresh is actually needed (queue already full = skip).
  const depths = await container.queue.depth();
  const totalDepth = depths.reduce((sum, d) => sum + d.depth, 0);
  if (totalDepth > 20) {
    log.push(`source refresh: skipped (queue full: ${totalDepth})`);
    return;
  }

  // Refresh.
  const scheduler = new SchedulerOrchestrator(container);
  await scheduler.refreshSources();
  await container.kv.set(REFRESH_KEY, String(now));
  log.push(`source refresh: complete`);
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

/**
 * src/entry/cron.ts
 * v12.0.0 — Three-Layer Cron Router.
 *
 * Routes Cloudflare cron events to the appropriate layer handler:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  every 20 min     →  Layer 1: Scheduler Watcher              │
 *   │                     (check due posts, publish if ready)      │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  every 2 hours    →  Layer 2: Provider Refresh              │
 *   │                     (fetch content, maintain queues)         │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  every 24 hours   →  Layer 3: Daily Maintenance             │
 *   │                     (generate plan, cleanup, reset)          │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Each layer is independent and has a single responsibility.
 * See V12_ARCHITECTURE.md for the full design.
 *
 * BACKWARD COMPATIBILITY:
 *   The `processScheduledQueue` function is still exported here for
 *   use by the manual /internal/tick endpoint and the debug dashboard.
 */

import type { Container, Env } from "../types/env";
import { cronSchedulerHandler } from "./cron-scheduler";
import { cronProvidersHandler } from "./cron-providers";
import { cronMaintenanceHandler } from "./cron-maintenance";

export interface CronHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

/**
 * Main cron router. Dispatches to the correct layer based on the cron expression.
 */
export async function cronHandler(
  event: ScheduledEvent,
  deps: CronHandlerDeps,
): Promise<void> {
  const { env, container, ctx } = deps;

  // ── Layer 1: Scheduler Watcher (every 20 minutes) ────
  // The primary publishing trigger. Lightweight — 0 KV writes on no-due path.
  if (event.cron === "*/20 * * * *") {
    await cronSchedulerHandler({ env, container, ctx });
    return;
  }

  // ── Layer 2: Provider Refresh (every 2 hours) ────
  // Fetches content, maintains queue depth. Does NOT publish.
  if (event.cron === "0 */2 * * *") {
    await cronProvidersHandler({ env, container, ctx });
    return;
  }

  // ── Layer 3: Daily Maintenance (every 24 hours) ────
  // Generates tomorrow's plan, cleans KV, resets counters.
  if (event.cron === "0 0 * * *") {
    await cronMaintenanceHandler({ env, container, ctx });
    return;
  }

  // Unknown cron expression — log for debugging.
  console.warn(`[cron] unrecognised cron expression: ${event.cron}`);
}

/**
 * Process the silent scheduling fallback queue.
 * Sends messages that Telegram failed to schedule natively.
 *
 * This is exported so it can be called from:
 *   - Layer 1 scheduler watcher (every 20 min)
 *   - The manual /internal/tick endpoint
 *   - The debug dashboard (POST /debug/api/test/cron)
 */
export async function processScheduledQueue(env: Env, container: Container): Promise<void> {
  const due = await container.kv.listDueScheduled();
  if (due.length === 0) return;

  for (const item of due) {
    try {
      const chatId = item["chatId"] as number | string;
      const text = item["text"] as string;
      const parseMode = item["parseMode"] as string | undefined;
      const mediaType = item["mediaType"] as string | undefined;
      const mediaFileId = item["mediaFileId"] as string | null | undefined;

      const res = await container.tg.publishToChannel(chatId, {
        text,
        mediaType: (mediaType as "photo" | "video" | "animation" | "document" | "none") ?? "none",
        mediaFileId: mediaFileId ?? null,
        extra: parseMode ? { parse_mode: parseMode } : {},
      });

      if (res.ok) {
        await container.kv.deleteScheduledItem(item["_kvKey"]);
      } else {
        console.error(`[cron] ✗ failed: ${res.description ?? "unknown"}`);
        // Permanent errors → delete the item so it doesn't retry forever.
        const permanentErrors = ["chat not found", "bot was blocked", "CHAT_ADMIN_REQUIRED"];
        const isPermanent = permanentErrors.some((e) =>
          (res.description ?? "").toLowerCase().includes(e.toLowerCase()),
        );
        if (isPermanent) {
          await container.kv.deleteScheduledItem(item["_kvKey"]);
        }
      }
    } catch (error) {
      console.error(
        `[cron] exception processing item:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Flush batched stats after the run.
  await container.kv.flushAllStats();
  void env;
}

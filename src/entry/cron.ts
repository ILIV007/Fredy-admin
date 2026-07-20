/**
 * src/entry/cron.ts
 * v12.0.8 — Hybrid Cron Router.
 *
 * Cloudflare Cron handles ONLY time-critical operations:
 *   - Layer 1: Scheduler Watcher (every 20 min) — publishes due posts
 *   - Layer 3: Daily Maintenance (every 24h) — generates plan, cleanup
 *
 * Layer 2 (Provider Refresh) is NOT a Cloudflare cron trigger.
 * It is called externally via GET /internal/provider-refresh
 * by cron-job.org every 2 hours. See cron-providers.ts.
 */

import type { Container, Env } from "../types/env";
import { cronSchedulerHandler } from "./cron-scheduler";
import { cronMaintenanceHandler } from "./cron-maintenance";

export interface CronHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

/**
 * Main cron router. Dispatches to the correct layer based on the cron expression.
 * v12.0.8: Only Layer 1 + Layer 3 are Cloudflare cron triggers.
 */
export async function cronHandler(
  event: ScheduledEvent,
  deps: CronHandlerDeps,
): Promise<void> {
  const { env, container, ctx } = deps;

  // ── Layer 1: Scheduler Watcher (every 20 minutes) ────
  if (event.cron === "*/20 * * * *") {
    await cronSchedulerHandler({ env, container, ctx });
    return;
  }

  // ── Layer 3: Daily Maintenance (every 24 hours) ────
  if (event.cron === "0 0 * * *") {
    await cronMaintenanceHandler({ env, container, ctx });
    return;
  }

  console.warn(`[cron] unrecognised cron expression: ${event.cron}`);
}

/**
 * Process the silent scheduling fallback queue.
 * Exported for use by Layer 1 + the manual /internal/tick endpoint.
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
        console.error(`[cron] failed: ${res.description ?? "unknown"}`);
        const permanentErrors = ["chat not found", "bot was blocked", "CHAT_ADMIN_REQUIRED"];
        const isPermanent = permanentErrors.some((e) =>
          (res.description ?? "").toLowerCase().includes(e.toLowerCase()),
        );
        if (isPermanent) {
          await container.kv.deleteScheduledItem(item["_kvKey"]);
        }
      }
    } catch (error) {
      console.error(`[cron] exception:`, error instanceof Error ? error.message : error);
    }
  }

  await container.kv.flushAllStats();
  void env;
}

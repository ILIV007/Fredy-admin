/**
 * src/entry/cron.ts
 * Cloudflare cron trigger handler (backup).
 *
 * Architecture:
 *   - Primary scheduler: external service (cron-job.org) calls /internal/tick
 *     every 2 hours. This is the main driver.
 *   - Backup scheduler: Cloudflare internal cron fires every 24 hours
 *     (configured in wrangler.toml as crons = ["0 slash-star 24 star-star star"]).
 *     This is a safety net in case cron-job.org stops working.
 *
 * SINGLE POINT OF FAILURE: if cron-job.org goes down, posts may be
 * delayed by up to 24 hours (until the backup cron fires). Recommended
 * mitigation: set up an uptime monitor on /internal/tick that alerts
 * the admin via a separate channel (not this bot) if it stops receiving
 * successful responses.
 *
 * The handler also runs the silent scheduling fallback queue:
 *   List due messages from KV (fredy:sched:queue:...) and send them via
 *   TelegramService.publishToChannel. This catches messages that Telegram
 *   silently failed to schedule (returned ok:true but sent immediately).
 *
 * See ARCHITECTURE_RULES.md section 3.1, 21.8.
 */

import type { Container, Env } from "../types/env";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";

export interface CronHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

export async function cronHandler(
  event: ScheduledEvent,
  deps: CronHandlerDeps,
): Promise<void> {
  const { env, container, ctx } = deps;
  console.log(`[cron] tick — cron="${event.cron}" at ${new Date().toISOString()}`);

  // 24-hour backup cron — runs the full tick as a safety net.
  if (event.cron === "0 */24 * * *") {
    console.log("[cron] 24h backup tick — running full pipeline");
    ctx.waitUntil(processScheduledQueue(env, container));
    ctx.waitUntil(
      (async () => {
        const scheduler = new SchedulerOrchestrator(container);
        const result = await scheduler.tick();
        if (result.fired) {
          console.log(`[cron] slot fired: index=${result.slot?.index ?? "?"} category=${result.slot?.category ?? "?"}`);
        } else if (result.skipped) {
          console.log(`[cron] slot skipped: ${result.skipReason ?? "unknown"}`);
        }
        // Also refresh sources.
        await scheduler.refreshSources();
        console.log("[cron] 24h backup complete");
      })(),
    );
    return;
  }

  // Every-minute tick (if enabled).
  if (event.cron === "* * * * *") {
    ctx.waitUntil(processScheduledQueue(env, container));
    ctx.waitUntil(
      (async () => {
        const scheduler = new SchedulerOrchestrator(container);
        const result = await scheduler.tick();
        if (result.fired) {
          console.log(`[cron] slot fired: index=${result.slot?.index ?? "?"} category=${result.slot?.category ?? "?"}`);
        } else if (result.skipped) {
          console.log(`[cron] slot skipped: ${result.skipReason ?? "unknown"}`);
        }
      })(),
    );
    return;
  }

  console.log(`[cron] unknown schedule: ${event.cron}`);
}

/**
 * Process the silent scheduling fallback queue.
 * Sends messages that Telegram failed to schedule natively.
 *
 * This is a separate function so it can also be triggered manually
 * from the debug dashboard (POST /debug/api/test/cron).
 */
export async function processScheduledQueue(env: Env, container: Container): Promise<void> {
  const due = await container.kv.listDueScheduled();
  if (due.length === 0) return;

  console.log(`[cron] found ${due.length} due scheduled messages`);

  for (const item of due) {
    try {
      const chatId = item["chatId"] as number | string;
      const text = item["text"] as string;
      const parseMode = item["parseMode"] as string | undefined;
      const mediaType = item["mediaType"] as string | undefined;
      const mediaFileId = item["mediaFileId"] as string | null | undefined;
      const scheduledTime = item["scheduledTime"] as number;

      console.log(
        `[cron] sending scheduled message ${item["id"]} to ${chatId} ` +
          `(was scheduled for ${new Date(scheduledTime).toISOString()})`,
      );

      const res = await container.tg.publishToChannel(chatId, {
        text,
        mediaType: (mediaType as "photo" | "video" | "animation" | "document" | "none") ?? "none",
        mediaFileId: mediaFileId ?? null,
        extra: parseMode ? { parse_mode: parseMode } : {},
      });

      if (res.ok) {
        console.log(`[cron] ✓ sent message ${item["id"]}`);
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

  // Flush batched stats after the cron run.
  await container.kv.flushAllStats();
  void env;
}

/**
 * src/entry/cron.ts
 * Cron trigger handler. Two crons fire this (configured in wrangler.toml):
 *   - Every minute      → scheduler tick (check for due slots, send queued messages)
 *   - Every 15 minutes  → source refresh (keep content caches warm)
 *
 * The cron handler also runs the silent scheduling fallback queue:
 *   List due messages from KV (fredy:sched:queue:*) and send them via
 *   TelegramService.publishToChannel. This catches messages that Telegram
 *   silently failed to schedule (returned ok:true but sent immediately).
 *
 * Pattern inherited from AI Admin src/index.js processScheduledQueue (lines 427-469).
 *
 * See ARCHITECTURE_RULES.md §3.1, §21.8.
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
  console.log(`[cron] tick at ${new Date().toISOString()}`);

  // Single cron trigger (every minute).
  // Runs: scheduler tick + source refresh + scheduled queue processing.
  ctx.waitUntil(processScheduledQueue(env, container));
  ctx.waitUntil(
    (async () => {
      const scheduler = new SchedulerOrchestrator(container);

      // 1. Scheduler tick — fire due slots.
      const result = await scheduler.tick();
      if (result.fired) {
        console.log(`[cron] slot fired: index=${result.slot?.index ?? "?"} category=${result.slot?.category ?? "?"}`);
      } else if (result.skipped) {
        console.log(`[cron] slot skipped: ${result.skipReason ?? "unknown"}`);
      }

      // 2. Source refresh — keep caches warm (every 15th minute).
      const minute = new Date().getMinutes();
      if (minute % 15 === 0) {
        await scheduler.refreshSources();
        console.log("[cron] source refresh complete");
      }
    })(),
  );
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

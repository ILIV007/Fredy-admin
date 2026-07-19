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
import { acquireTickLock } from "../services/tick-lock";

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

  // 24-hour backup cron — runs the full tick as a safety net.
  // v8.10.3: Fixed cron string from "0 */24 * * *" (invalid on Cloudflare)
  // to "0 0 * * *" (midnight UTC daily).
  if (event.cron === "0 0 * * *") {
    ctx.waitUntil(processScheduledQueue(env, container));
    ctx.waitUntil(
      (async () => {
        // v9.1.0: Stale-tick alert — check if the external cron has stopped.
        // If LAST_TICK_KEY is older than 4 hours, the external cron is likely down.
        const LAST_TICK_KEY = "fredy:tick:lastTick";
        const lastTickStr = await container.kv.get(LAST_TICK_KEY).catch(() => null);
        if (lastTickStr) {
          const lastTick = Number(lastTickStr);
          const hoursSinceLastTick = (Date.now() - lastTick) / (60 * 60 * 1000);
          if (hoursSinceLastTick > 4) {
            const adminId = Number(env.ADMIN_ID ?? "0");
            if (adminId > 0) {
              await container.tg.sendMessage(adminId, [
                ``,
                `<b>━━━ ⚠️ STALE TICK ALERT ━━━</b>`,
                ``,
                ``,
                `<blockquote>⏰ <b>Last tick:</b> ${hoursSinceLastTick.toFixed(1)} hours ago</blockquote>`,
                `<blockquote>💡 <b>External cron (cron-job.org) may be down.</b></blockquote>`,
                `<blockquote>📅 <b>Time:</b> ${new Date().toISOString()}</blockquote>`,
              ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            }
          }
        }

        const lock = await acquireTickLock(container.kv, 90);
        if (!lock.acquired) {
          console.log("[cron] tick lock held — skipping");
          return;
        }
        try {
          const scheduler = new SchedulerOrchestrator(container);
          const result = await scheduler.tick();
          if (result.fired) {
            console.log("[cron-24h] slot fired:", result.slot?.category);
          } else if (result.skipped) {
            console.log("[cron-24h] slot skipped:", result.skipReason);
          }
          // Also refresh sources.
          await scheduler.refreshSources();
        } finally {
          await lock.release();
        }
      })(),
    );
    return;
  }

  // v8.10.3: Removed every-minute cron handler — not needed.
  // The external cron (cron-job.org) calls /internal/tick every 2 hours,
  // and the daily backup cron at midnight UTC is the safety net.
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

  // Flush batched stats after the cron run.
  await container.kv.flushAllStats();
  void env;
}

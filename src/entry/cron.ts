/**
 * src/entry/cron.ts
 * Cloudflare cron trigger handlers.
 *
 * Architecture:
 *   - Primary scheduler: external service (cron-job.org) calls /internal/tick
 *     every 2 hours. This is the main driver.
 *   - Backup scheduler: Cloudflare internal cron fires every 24 hours
 *     (`0 0 * * *`, midnight UTC). Runs the full tick as a safety net.
 *   - Stale-tick watchdog: Cloudflare internal cron fires every 30 minutes
 *     (`* slash-30 * * * *`). Performs a single KV read; if the external
 *     cron has not registered a tick in the last 4 hours, sends one admin PM.
 *     This is cheap (1 KV read per fire, 1 KV write + 1 TG send only when
 *     stale) and gives ~30-minute detection latency instead of next-midnight.
 *
 * SINGLE POINT OF FAILURE: if cron-job.org goes down, the admin will be
 * notified within ~30 minutes via the stale-tick watchdog, and the backup
 * cron will fire the missed slot within 24 hours.
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

/** v9.2.1: Stale-tick threshold (4 hours). If the external cron hasn't
 *  registered a tick in this window, the watchdog sends a single admin PM. */
const STALE_TICK_HOURS = 4;
/** v9.2.1: Cooldown on stale-tick PMs to avoid spamming the admin.
 *  Once sent, subsequent stale fires within this window are suppressed. */
const STALE_TICK_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const STALE_TICK_LAST_ALERT_KEY = "fredy:tick:lastStaleAlert";
const LAST_TICK_KEY = "fredy:tick:lastTick";

export async function cronHandler(
  event: ScheduledEvent,
  deps: CronHandlerDeps,
): Promise<void> {
  const { env, container, ctx } = deps;

  // ── 30-minute stale-tick watchdog ────────────────────
  // Cheap: 1 KV read normally, +1 KV write + 1 TG send only when stale.
  if (event.cron === "*/30 * * * *") {
    ctx.waitUntil(checkStaleTick(env, container));
    return;
  }

  // ── 24-hour backup cron — runs the full tick as a safety net ────
  // v8.10.3: Fixed cron string from "0 */24 * * *" (invalid on Cloudflare)
  // to "0 0 * * *" (midnight UTC daily).
  if (event.cron === "0 0 * * *") {
    ctx.waitUntil(processScheduledQueue(env, container));
    // Also run the stale-tick check on the daily cron — extra safety.
    ctx.waitUntil(checkStaleTick(env, container));
    ctx.waitUntil(
      (async () => {
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
        } finally {
          await lock.release();
        }
      })(),
    );
    return;
  }

  console.warn(`[cron] unrecognised cron expression: ${event.cron}`);
}

/**
 * v9.2.1: Stale-tick watchdog — checks if the external cron has stopped.
 * Runs every 30 minutes. Sends a single admin PM when stale is detected,
 * then suppresses repeats for STALE_TICK_ALERT_COOLDOWN_MS.
 *
 * Cost: 1 KV read (always) + 1 KV read (cooldown, only when stale) +
 * 1 KV write + 1 TG send (only when stale AND outside cooldown).
 */
async function checkStaleTick(env: Env, container: Container): Promise<void> {
  try {
    const lastTickStr = await container.kv.get(LAST_TICK_KEY).catch(() => null);
    if (!lastTickStr) {
      // No tick has ever been registered. Skip — bot may have just deployed.
      return;
    }
    const lastTick = Number(lastTickStr);
    if (!Number.isFinite(lastTick)) return;
    const hoursSinceLastTick = (Date.now() - lastTick) / (60 * 60 * 1000);
    if (hoursSinceLastTick <= STALE_TICK_HOURS) {
      return; // Fresh — nothing to report.
    }

    // Stale detected — check cooldown to avoid spamming the admin.
    const lastAlertStr = await container.kv.get(STALE_TICK_LAST_ALERT_KEY).catch(() => null);
    const lastAlert = lastAlertStr ? Number(lastAlertStr) : 0;
    if (lastAlert && Date.now() - lastAlert < STALE_TICK_ALERT_COOLDOWN_MS) {
      return; // Already alerted recently — suppress.
    }

    const adminId = Number(env.ADMIN_ID ?? "0");
    if (adminId > 0) {
      await container.tg.sendMessage(
        adminId,
        [
          ``,
          `<b>━━━ ⚠️ STALE TICK ALERT ━━━</b>`,
          ``,
          ``,
          `<blockquote>⏰ <b>Last tick:</b> ${hoursSinceLastTick.toFixed(1)} hours ago</blockquote>`,
          `<blockquote>💡 <b>External cron (cron-job.org) may be down.</b></blockquote>`,
          `<blockquote>📅 <b>Time:</b> ${new Date().toISOString()}</blockquote>`,
        ].join("\n"),
        { parse_mode: "HTML" },
      ).catch(() => {});
    }
    // Record the alert time so we don't spam.
    await container.kv.set(STALE_TICK_LAST_ALERT_KEY, String(Date.now()), 6 * 60 * 60).catch(() => {});
  } catch (error) {
    console.error("[cron-30m] stale-tick check failed:", error instanceof Error ? error.message : error);
  }
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

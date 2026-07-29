/**
 * src/services/tier-v-scheduler.ts
 * v12.0.9 — Tier V Scheduled Content Scheduler.
 *
 * Tier V is for fixed-schedule content (NASA APOD, weekly reports, etc).
 * Unlike normal window-based scheduling:
 *   - NO random jitter (publishes at the exact configured time)
 *   - NO category queue (fetches on demand from the configured provider)
 *   - NO provider refresh (Tier V providers fetch when due, not on Layer 2)
 *
 * The scheduler is called by Layer 1 (cron-scheduler.ts) alongside the
 * normal window-based findDueSlot(). It checks each Tier V entry:
 *   1. Is it enabled?
 *   2. Has the configured time been reached today (in the configured TZ)?
 *   3. Has it already been published today? (checks KV marker)
 *   4. If due + not published → fetch content from provider → publish
 *
 * KV usage:
 *   - Read: fredy:tierV:sent:<date>:<entryId> (check if already published)
 *   - Write: same key after successful publish (1 write per Tier V post/day)
 *
 * The existing publishing pipeline (FinalPublisher) is reused — Tier V
 * goes through the same dedup → AI → image → Telegram → history path.
 */

import type { Container } from "../types/env";
import type { FredySettings } from "../types/config";
import type { TierVEntry } from "../core/config/sections/tier-v";
import type { PublishResult } from "../types/scheduler";
import type { ReadyContent } from "../types/content";
import { formatDateInZone } from "../primitives/time";

const TIER_V_SENT_PREFIX = "fredy:tierV:sent";
const TIER_V_SENT_TTL = 48 * 3600; // 48 hours
const TIER_V_ATTEMPT_PREFIX = "fredy:tierV:attempt"; // v13.3.12: retry tracking
const TIER_V_ATTEMPT_TTL = 6 * 3600; // 6 hours — enough for 2 attempts in one night
const TIER_V_MAX_ATTEMPTS = 2; // v13.3.12: max 2 attempts per entry per night

export interface TierVSchedulerDeps {
  readonly container: Container;
}

export class TierVScheduler {
  constructor(private readonly deps: TierVSchedulerDeps) {}

  /**
   * Check all Tier V entries and publish any that are due.
   * Called by Layer 1 (cron-scheduler.ts) on every 20-min tick.
   *
   * Returns the number of Tier V posts published (0 or 1 typically).
   */
  async checkAndPublish(settings: FredySettings, now: number): Promise<number> {
    const entries = settings.tierV?.entries ?? [];
    if (entries.length === 0) return 0;

    const tz = settings.scheduler.timezone || "UTC";

    // v13.4.3: Use standard date (no -1h offset). Tier V is now at 23:20/23:23,
    // which is BEFORE midnight and BEFORE quiet hours (00:00-07:30).
    // This means:
    // - Posts publish at 23:20/23:23 on the current day
    // - Daily reset happens at midnight (standard date change)
    // - Dashboard shows correct "pending/published" status during the day
    // - No conflict with quiet hours
    const tierVDate = formatDateInZone(now, tz);

    // Get current time in minutes-since-midnight (timezone-aware).
    const nowInTz = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(now));
    const [nowH, nowM] = nowInTz.split(":").map(Number);
    const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

    let published = 0;

    for (const entry of entries) {
      if (!entry.enabled) continue;

      // Parse the fixed time (e.g., "00:03" → 3 minutes).
      const [eH, eM] = entry.time.split(":").map(Number);
      const entryMinutes = (eH ?? 0) * 60 + (eM ?? 0);

      // Check if the time has been reached.
      if (nowMinutes < entryMinutes) continue; // not yet

      // v13.4.1: Use tierVDate (offset by -1h) for sent marker.
      const sentKey = `${TIER_V_SENT_PREFIX}:${tierVDate}:${entry.id}`;
      const alreadySent = await this.deps.container.kv.get(sentKey).catch(() => null);
      if (alreadySent) continue;

      // v13.4.1: Use tierVDate for attempt tracking too.
      const attemptKey = `${TIER_V_ATTEMPT_PREFIX}:${tierVDate}:${entry.id}`;
      const attemptStr = await this.deps.container.kv.get(attemptKey).catch(() => null);
      const attemptCount = attemptStr ? parseInt(attemptStr, 10) : 0;
      if (attemptCount >= TIER_V_MAX_ATTEMPTS) {
        // Already tried max times — skip silently (admin was already notified).
        continue;
      }

      // Due! Fetch content from the provider and publish.
      this.deps.container.logger.info("tierV.publish_start", {
        entryId: entry.id,
        providerId: entry.providerId,
        scheduledTime: entry.time,
        nowTime: nowInTz,
        attempt: attemptCount + 1,
        maxAttempts: TIER_V_MAX_ATTEMPTS,
        message: `Tier V entry "${entry.id}" is due — attempt ${attemptCount + 1}/${TIER_V_MAX_ATTEMPTS}`,
      });

      try {
        const result = await this.publishEntry(entry, settings, now);
        if (result.ok) {
          published++;
          // Mark as sent so we don't republish today.
          await this.deps.container.kv.set(sentKey, String(now), TIER_V_SENT_TTL).catch(() => {});
          // Clear attempt counter (no longer needed).
          await this.deps.container.kv.delete(attemptKey).catch(() => {});
          this.deps.container.logger.info("tierV.publish_success", {
            entryId: entry.id,
            contentId: result.contentId,
            messageId: result.telegramMessageId,
          });
        } else {
          // Failed — increment attempt counter.
          const newAttemptCount = attemptCount + 1;
          await this.deps.container.kv.set(attemptKey, String(newAttemptCount), TIER_V_ATTEMPT_TTL).catch(() => {});

          this.deps.container.logger.warn("tierV.publish_failed", {
            entryId: entry.id,
            error: result.error,
            attempt: newAttemptCount,
            maxAttempts: TIER_V_MAX_ATTEMPTS,
            willRetry: newAttemptCount < TIER_V_MAX_ATTEMPTS,
          });

          // v13.3.12: If this was the last attempt, notify admin.
          if (newAttemptCount >= TIER_V_MAX_ATTEMPTS) {
            await this.notifyAdminOfFailure(entry, result.error ?? "unknown error", nowInTz).catch(() => {});
          }
        }
      } catch (error) {
        // Exception — increment attempt counter.
        const newAttemptCount = attemptCount + 1;
        await this.deps.container.kv.set(attemptKey, String(newAttemptCount), TIER_V_ATTEMPT_TTL).catch(() => {});

        this.deps.container.logger.error("tierV.publish_error", {
          entryId: entry.id,
          error: error instanceof Error ? error.message : String(error),
          attempt: newAttemptCount,
          maxAttempts: TIER_V_MAX_ATTEMPTS,
          willRetry: newAttemptCount < TIER_V_MAX_ATTEMPTS,
        });

        // If this was the last attempt, notify admin.
        if (newAttemptCount >= TIER_V_MAX_ATTEMPTS) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await this.notifyAdminOfFailure(entry, errMsg, nowInTz).catch(() => {});
        }
      }
    }

    return published;
  }

  /**
   * Fetch content from the Tier V provider and publish via the existing pipeline.
   * Reuses contentManager.processFromPlugin() + finalPublisher.publish().
   */
  private async publishEntry(
    entry: TierVEntry,
    settings: FredySettings,
    now: number,
  ): Promise<PublishResult> {
    const container = this.deps.container;

    // v13.4.12: For NASA, pass skipDedup: true because the NASA plugin
    // already does its OWN dedup-aware selection (it checks the dedup KV
    // and picks the most recent unpublished image APOD). If we don't skip
    // Stage 6, a "throwback" APOD (all recent images already published)
    // would be rejected by the pipeline's dedup check, and no NASA post
    // would ever be sent on consecutive video days.
    //
    // For other Tier V providers (e.g., night-music), keep the normal
    // dedup check (they have their own dedup systems that don't conflict).
    const isNasa = entry.providerId === "nasa";
    const pipelineResult = await container.content.processFromPlugin(
      entry.providerId,
      settings.language.default,
      { skipEnqueue: true, skipDedup: isNasa },
    );

    if (!pipelineResult.ok || !pipelineResult.content) {
      return {
        ok: false,
        contentId: null,
        category: entry.category as PublishResult["category"],
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: now,
        error: pipelineResult.error ?? `Tier V provider "${entry.providerId}" returned no content`,
        attempts: 0,
      };
    }

    const content: ReadyContent = pipelineResult.content;

    // Publish via the existing FinalPublisher (dedup + AI + image + Telegram + history).
    const pubResult = await container.finalPublisher.publish(content);

    // Send admin PM notification (same as normal publish path).
    if (pubResult.ok) {
      const adminId = Number(container.env.ADMIN_ID ?? "0");
      if (adminId > 0 && container.tg) {
        // Send the exact same post to admin PM.
        if (pubResult.sentText) {
          if (pubResult.sentMediaUrl) {
            await container.tg.sendPhoto(adminId, pubResult.sentMediaUrl, pubResult.sentText, {
              parse_mode: "HTML",
            }).catch(() => {});
          } else {
            await container.tg.sendMessage(adminId, pubResult.sentText, {
              parse_mode: "HTML",
            }).catch(() => {});
          }
        }
        // Send the Tier V summary report.
        await container.tg.sendMessage(adminId, [
          ``,
          `<b>━━━ 🟣 TIER V PUBLISHED ━━━</b>`,
          ``,
          ``,
          `<blockquote>🏷️ <b>Entry:</b> ${entry.id}</blockquote>`,
          `<blockquote>📡 <b>Provider:</b> ${entry.providerId}</blockquote>`,
          `<blockquote>⏰ <b>Scheduled:</b> ${entry.time} (fixed)</blockquote>`,
          `<blockquote>📰 <b>Headline:</b> ${content.headline ?? "(none)"}</blockquote>`,
          `<blockquote>📤 <b>Channel Msg ID:</b> ${pubResult.telegramMessageId}</blockquote>`,
        ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
      }
    }

    return pubResult;
  }

  /** v13.3.12: Notify admin when a Tier V entry fails after all retry attempts. */
  private async notifyAdminOfFailure(
    entry: TierVEntry,
    error: string,
    nowTime: string,
  ): Promise<void> {
    const container = this.deps.container;
    const adminId = Number(container.env.ADMIN_ID ?? "0");
    if (adminId <= 0 || !container.tg) return;

    const isNightMusic = entry.providerId === "night-music";
    const emoji = isNightMusic ? "🎵" : "🪐";

    await container.tg.sendMessage(adminId, [
      ``,
      `<b>━━━ ${emoji} TIER V FAILED ━━━</b>`,
      ``,
      ``,
      `<blockquote>🏷️ <b>Entry:</b> ${entry.id}</blockquote>`,
      `<blockquote>📡 <b>Provider:</b> ${entry.providerId}</blockquote>`,
      `<blockquote>⏰ <b>Scheduled:</b> ${entry.time} (fixed)</blockquote>`,
      `<blockquote>🕐 <b>Failed at:</b> ${nowTime}</blockquote>`,
      `<blockquote>❌ <b>Error:</b> ${error}</blockquote>`,
      `<blockquote>🔄 <b>Attempts:</b> ${TIER_V_MAX_ATTEMPTS}/${TIER_V_MAX_ATTEMPTS} (exhausted)</blockquote>`,
      `<blockquote>⏭️ <b>Action:</b> Skipped for tonight — will retry tomorrow.</blockquote>`,
    ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
  }

  /**
   * Get the next due Tier V entry (for dashboard display).
   * Returns the next entry whose time is in the future, or null if all are done today.
   */
  getNextDueEntry(settings: FredySettings, now: number): {
    entry: TierVEntry;
    remainingMinutes: number;
  } | null {
    const entries = settings.tierV?.entries ?? [];
    if (entries.length === 0) return null;

    const tz = settings.scheduler.timezone || "UTC";
    const nowInTz = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(now));
    const [nowH, nowM] = nowInTz.split(":").map(Number);
    const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

    let next: { entry: TierVEntry; remainingMinutes: number } | null = null;
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const [eH, eM] = entry.time.split(":").map(Number);
      const entryMinutes = (eH ?? 0) * 60 + (eM ?? 0);
      if (entryMinutes <= nowMinutes) continue; // already past
      const remaining = entryMinutes - nowMinutes;
      if (!next || remaining < next.remainingMinutes) {
        next = { entry, remainingMinutes: remaining };
      }
    }
    return next;
  }

  /** v12.1.3: Get published status for all Tier V entries (for dashboard).
   *  v13.4.3: Use standard date (no -1h offset). */
  async getPublishedStatus(settings: FredySettings, now: number): Promise<Record<string, { published: boolean; publishedAt: number | null }>> {
    const entries = settings.tierV?.entries ?? [];
    const result: Record<string, { published: boolean; publishedAt: number | null }> = {};
    const tz = settings.scheduler.timezone || "UTC";
    const tierVDate = formatDateInZone(now, tz);

    for (const entry of entries) {
      const sentKey = `${TIER_V_SENT_PREFIX}:${tierVDate}:${entry.id}`;
      const sentValue = await this.deps.container.kv.get(sentKey).catch(() => null);
      if (sentValue) {
        const publishedAt = Number(sentValue);
        result[entry.id] = { published: true, publishedAt: Number.isFinite(publishedAt) ? publishedAt : null };
      } else {
        result[entry.id] = { published: false, publishedAt: null };
      }
    }
    return result;
  }
}

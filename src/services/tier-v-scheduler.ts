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
    const today = formatDateInZone(now, tz);

    // Get current time in minutes-since-midnight (timezone-aware).
    const nowInTz = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(now));
    const [nowH, nowM] = nowInTz.split(":").map(Number);
    const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

    let published = 0;

    for (const entry of entries) {
      if (!entry.enabled) continue;

      // Parse the fixed time (e.g., "22:30" → 1350 minutes).
      const [eH, eM] = entry.time.split(":").map(Number);
      const entryMinutes = (eH ?? 0) * 60 + (eM ?? 0);

      // Check if the time has been reached.
      if (nowMinutes < entryMinutes) continue; // not yet

      // Check if already published today.
      const sentKey = `${TIER_V_SENT_PREFIX}:${today}:${entry.id}`;
      const alreadySent = await this.deps.container.kv.get(sentKey).catch(() => null);
      if (alreadySent) continue;

      // Due! Fetch content from the provider and publish.
      this.deps.container.logger.info("tierV.publish_start", {
        entryId: entry.id,
        providerId: entry.providerId,
        scheduledTime: entry.time,
        nowTime: nowInTz,
        message: `Tier V entry "${entry.id}" is due — publishing`,
      });

      try {
        const result = await this.publishEntry(entry, settings, now);
        if (result.ok) {
          published++;
          // Mark as sent so we don't republish today.
          await this.deps.container.kv.set(sentKey, String(now), TIER_V_SENT_TTL).catch(() => {});
          this.deps.container.logger.info("tierV.publish_success", {
            entryId: entry.id,
            contentId: result.contentId,
            messageId: result.telegramMessageId,
          });
        } else {
          this.deps.container.logger.warn("tierV.publish_failed", {
            entryId: entry.id,
            error: result.error,
          });
        }
      } catch (error) {
        this.deps.container.logger.error("tierV.publish_error", {
          entryId: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
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

    // Fetch content from the configured provider (skipEnqueue — direct publish).
    const pipelineResult = await container.content.processFromPlugin(
      entry.providerId,
      settings.language.default,
      { skipEnqueue: true },
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
   * Returns a map of entryId → { published: boolean, publishedAt: number | null }. */
  async getPublishedStatus(settings: FredySettings, now: number): Promise<Record<string, { published: boolean; publishedAt: number | null }>> {
    const entries = settings.tierV?.entries ?? [];
    const result: Record<string, { published: boolean; publishedAt: number | null }> = {};
    const tz = settings.scheduler.timezone || "UTC";
    const today = formatDateInZone(now, tz);

    for (const entry of entries) {
      const sentKey = `${TIER_V_SENT_PREFIX}:${today}:${entry.id}`;
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

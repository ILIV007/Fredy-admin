/**
 * src/services/scheduler-service.ts
 * Scheduler Manager — orchestrates the full scheduling and publishing pipeline.
 *
 * Pipeline:
 *   Scheduler tick → Content Queue → Quality Check → Telegram Publisher → History
 *
 * Responsibilities:
 *   - Tick (called by cron every minute): check for due slots, fire them.
 *   - Daily planning: generate a new random schedule each day.
 *   - Manual publishing: publish A/B/C/plugin/NASA/random on demand.
 *   - Status reporting: for the dashboard.
 *
 * See Prompt 9 spec.
 */

import type {
  DailyPlan,
  ManualPublishOptions,
  PublishResult,
  SchedulerStatus,
  SchedulerTickResult,
  SlotTime,
} from "../types/scheduler";
import type { Category } from "../types/category";
import type { ReadyContent } from "../types/content";
import type { FredySettings } from "../types/config";
import type { DailyPlanner } from "./daily-planner";
import type { JobQueue } from "./job-queue";
import type { ContentManager } from "./content-manager";
import type { ContentQueue } from "./content-queue";
import type { HistoryService } from "./history-service";
import type { Logger } from "./logger";
import type { TelegramService } from "./telegram";
import type { UXLayer } from "./ux-layer";
import type { QuietHoursChecker } from "./quiet-hours-checker";
import { SchedulerDisabledError } from "../core/scheduler/errors";
import { escapeHtml } from "../primitives/strings";

/** Publisher interface — both PublishingService and FinalPublisher implement this. */
export interface Publisher {
  publish(content: ReadyContent): Promise<PublishResult>;
}

export interface SchedulerServiceDeps {
  readonly logger: Logger;
  readonly dailyPlanner: DailyPlanner;
  readonly jobQueue: JobQueue;
  readonly publishingService: Publisher;
  readonly contentManager: ContentManager;
  readonly contentQueue: ContentQueue;
  readonly history: HistoryService;
  readonly quietHoursChecker?: QuietHoursChecker;
  readonly settings: () => Promise<FredySettings>;
  readonly tg?: TelegramService;
  readonly uxLayer?: UXLayer;
  readonly adminId?: () => number;
  readonly duplicateDetector?: import("./duplicate-detector").DuplicateDetector;
  /** v8.2.1: Strategy engine — used to update Daily Plan status after publish. */
  readonly strategyEngine?: import("./strategy-engine").StrategyEngine;
}

export class SchedulerService {
  private consecutiveFailures = 0;

  constructor(private readonly deps: SchedulerServiceDeps) {}

  /**
   * Tick — called by the cron handler every minute.
   * Checks for due slots and fires them.
   */
  async tick(now = Date.now()): Promise<SchedulerTickResult> {
    const settings = await this.deps.settings();

    // 1. Check if scheduler is enabled.
    if (!settings.scheduler.enabled) {
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: "Scheduler is disabled",
      };
    }

    // 1b. Check if bot is enabled (master kill switch).
    if (!settings.general.botEnabled) {
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: "Bot is disabled (botEnabled=false)",
      };
    }

    // 1c. Check maintenance mode (skip publishing, but still allow queue maintenance).
    if (settings.general.maintenanceMode) {
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: "Maintenance mode is ON",
      };
    }

    // 1d. Check approve mode — when ON, scheduler does NOT auto-publish.
    if (settings.approveMode) {
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: "Approve mode is ON (waiting for manual approval)",
      };
    }

    // 1e. Check quiet hours — no posts during this period.
    if (this.deps.quietHoursChecker) {
      const isQuiet = this.deps.quietHoursChecker.isQuietHours(now, settings.scheduler);
      if (isQuiet) {
        return {
          fired: false,
          slot: null,
          job: null,
          published: null,
          skipped: true,
          skipReason: `Quiet hours active (${settings.scheduler.quietHours.start}–${settings.scheduler.quietHours.end})`,
        };
      }
    }

    // 2. Get or generate today's plan.
    // v8.5.0: Use strategyEngine plan if available — it has provider/priority/status
    // and is the SAME plan shown on the Strategy page. This ensures the scheduler
    // fires the same slots the admin sees in the Daily Plan table.
    let plan: DailyPlan;
    try {
      if (this.deps.strategyEngine) {
        const stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
        // Convert DailyPublishPlan to DailyPlan format for the scheduler.
        plan = {
          date: stratPlan.date,
          slots: stratPlan.posts.map(p => ({
            index: p.index,
            date: p.date,
            time: p.time,
            epochMs: p.epochMs,
            category: p.category,
            jitterMinutes: 0,
          })),
          generatedAt: stratPlan.generatedAt,
          timezone: stratPlan.timezone,
          postsPerDay: stratPlan.posts.length,
          categoryDistribution: { A: 0, B: 0, C: 0 },
        };
        // Fill categoryDistribution from posts.
        for (const p of stratPlan.posts) {
          const dist = plan!.categoryDistribution as Record<string, number>;
          dist[p.category] = (dist[p.category] ?? 0) + 1;
        }
      } else {
        plan = await this.deps.dailyPlanner.getOrGenerate();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error("pipeline.error", {
        error: message,
        message: "Failed to get/generate daily plan",
      });
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: `Plan generation failed: ${message}`,
      };
    }

    // 3. Find a due, unfired slot.
    const dueSlot = await this.findDueSlot(plan, now);
    if (!dueSlot) {
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: "No due slots",
      };
    }

    // 4. Fire the slot.
    const publishResult = await this.fireSlot(dueSlot);

    return {
      fired: publishResult.ok,
      slot: dueSlot,
      job: null,
      published: publishResult.ok ? publishResult : null,
      skipped: !publishResult.ok,
      skipReason: publishResult.ok ? undefined : publishResult.error,
    };
  }

  /** Find a due, unfired slot.
   *  v8.5.1: When using strategyEngine plan, check the post's `status` field
   *  directly (not dailyPlanner.isSlotFired). This ensures the Daily Plan
   *  status is the single source of truth — if a post is "published" or
   *  "failed" in the strategy plan, it's skipped. */
  private async findDueSlot(plan: DailyPlan, now: number): Promise<SlotTime | null> {
    const GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes

    // v8.5.1: If using strategyEngine, get the plan to check post statuses.
    let stratPlan: import("../types/strategy").DailyPublishPlan | null = null;
    if (this.deps.strategyEngine) {
      try {
        stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
      } catch { /* non-fatal */ }
    }

    for (const slot of plan.slots) {
      // Check if slot is due (epochMs <= now).
      if (slot.epochMs > now) continue;

      // v8.5.1: Check if already fired — use strategy plan status if available,
      // otherwise fall back to dailyPlanner.isSlotFired().
      let alreadyFired = false;
      if (stratPlan) {
        const post = stratPlan.posts.find(p => p.index === slot.index);
        if (post && (post.status === "published" || post.status === "failed" || post.status === "backup")) {
          alreadyFired = true;
        }
      } else {
        alreadyFired = await this.deps.dailyPlanner.isSlotFired(slot);
      }
      if (alreadyFired) continue;

      // v8.0.0: 30-minute grace period — if slot is >30min overdue, mark
      // as "passed" instead of firing (avoids burst-publishing missed slots
      // after a long scheduler outage).
      if (now - slot.epochMs > GRACE_PERIOD_MS) {
        // v8.5.1: Mark as failed in strategy plan (not dailyPlanner).
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index).catch(() => {});
        }
        await this.deps.dailyPlanner.markSlotFired(slot, "passed-grace").catch(() => {});
        this.deps.logger.warn("scheduler.skip", {
          slotIndex: slot.index,
          date: slot.date,
          time: slot.time,
          reason: "slot_overdue_grace",
          message: "Slot >30min overdue — marking as passed",
        });
        continue;
      }

      return slot;
    }
    return null;
  }

  /** Fire a slot — dequeue content, validate, publish. */
  private async fireSlot(slot: SlotTime): Promise<PublishResult> {
    this.deps.logger.info("scheduler.slot_fired", {
      slotIndex: slot.index,
      date: slot.date,
      time: slot.time,
      category: slot.category,
      message: "Firing slot",
    });

    // 0. Load current settings once — used for language validation and
    //    as the language argument when generating fresh content.
    const settings = await this.deps.settings();
    // Resolve the *effective* target language (auto → fa/en) so we can
    // reject stale queued content that was generated under a different
    // language. Without this check, old English posts would keep being
    // published even after the operator switched the bot to Persian.
    const expectedLang = (settings.language.default === "fa" || settings.language.default === "en")
      ? settings.language.default
      : (settings.language.autoDetect ? "fa" : "en"); // matches language-injector's fallback

    // 1. Try to dequeue ready content for this category.
    // contentQueue.dequeue() returns QueuedContent (which wraps ReadyContent in .content).
    // We need to unwrap it to get the ReadyContent for publishing.
    // Stale-language items are skipped (dropped from queue) so the next
    // item or a fresh generation can take over.
    let content: ReadyContent | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const queued = await this.deps.contentQueue.dequeue(slot.category);
      if (!queued) break;
      const queuedLang = queued.content.language;
      if (queuedLang === expectedLang || queuedLang === settings.language.default) {
        content = queued.content;
        break;
      }
      // Stale language — log and try the next item.
      this.deps.logger.warn("scheduler.stale_language", {
        contentId: queued.content.id,
        queuedLanguage: queuedLang,
        expectedLanguage: expectedLang,
        message: "Dropping stale-language queued content",
      });
    }

    // 2. If queue is empty (or all stale), process a fresh item from a plugin.
    if (!content) {
      const pipelineResult = await this.deps.contentManager.processForCategory(
        slot.category,
        null, // anti-repeat handled by ContentManager via PluginManager
        settings.language.default,
        { skipEnqueue: true },
      );

      if (!pipelineResult.ok || !pipelineResult.content) {
        this.deps.logger.warn("scheduler.skip", {
          slotIndex: slot.index,
          category: slot.category,
          reason: pipelineResult.error ?? "Pipeline failed",
          message: "No content available — trying fallback plugin",
        });

        // v8.4.0: If the first API/plugin fails, try ONE fallback plugin at a time.
        // v8.5.0: Optimized — only try the NEXT plugin, not all at once.
        // The getFallbackPlugins returns all plugins for the category; we try
        // them one by one until one succeeds.
        const fallbackPlugins = this.getFallbackPlugins(slot.category);
        let fallbackContent: ReadyContent | null = null;
        for (const fbPlugin of fallbackPlugins) {
          if (fallbackContent) break; // Stop as soon as one succeeds.
          try {
            const fbResult = await this.deps.contentManager.processFromPlugin(
              fbPlugin,
              settings.language.default,
              { skipEnqueue: true },
            );
            if (fbResult.ok && fbResult.content) {
              fallbackContent = fbResult.content;
              this.deps.logger.info("pipeline.complete", {
                slotIndex: slot.index,
                fallbackPlugin: fbPlugin,
                contentId: fbResult.content.id,
                message: "Fallback plugin succeeded",
              });
            }
          } catch (e) {
            this.deps.logger.warn("source.fetch_error", {
              fallbackPlugin: fbPlugin,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        if (fallbackContent) {
          content = fallbackContent;
        } else {
          // v8.1.3: Send failure report to admin PM.
          const failItem = pipelineResult.item ? {
            id: pipelineResult.item.id,
            title: pipelineResult.item.title,
            url: pipelineResult.item.url,
            source: pipelineResult.item.pluginId,
          } : null;
          await this.notifyAdminOfFailure(slot, pipelineResult.error ?? "Pipeline failed (no fallback content)", failItem).catch(() => {});

          // v8.2.1: Mark strategy plan post as failed too.
          if (this.deps.strategyEngine) {
            await this.deps.strategyEngine.markPostFailed(slot.date, slot.index).catch(() => {});
          }

          // Mark slot as fired (to avoid retrying with no content).
          await this.deps.dailyPlanner.markSlotFired(slot, "no-content");

          return {
            ok: false,
            contentId: null,
            category: slot.category,
            telegramMessageId: null,
            telegramChatId: null,
            publishedAt: Date.now(),
            error: pipelineResult.error ?? "No content available",
            attempts: 0,
          };
        }
      } else {
        content = pipelineResult.content;
      }
    }

    // 3. Publish.
    try {
      const result = await this.deps.publishingService.publish(content);

      // 4. Mark slot as fired (success or failure — prevents infinite retry).
      await this.deps.dailyPlanner.markSlotFired(slot, content.id);

      // v8.8.0: If publish failed (quality gate, sendPhoto error, etc.),
      // try a fallback plugin from the same category before giving up.
      if (!result.ok && this.deps.contentManager) {
        this.deps.logger.warn("scheduler.skip", {
          slotIndex: slot.index,
          contentId: content.id,
          error: result.error,
          message: "Publish failed — trying fallback plugin",
        });

        const settings = await this.deps.settings();
        const fallbackPlugins = this.getFallbackPlugins(slot.category);
        let backupContent: ReadyContent | null = null;

        for (const fbPlugin of fallbackPlugins) {
          if (backupContent) break;
          try {
            const fbResult = await this.deps.contentManager.processFromPlugin(
              fbPlugin,
              settings.language.default,
              { skipEnqueue: true },
            );
            if (fbResult.ok && fbResult.content) {
              const fbPubResult = await this.deps.publishingService.publish(fbResult.content);
              if (fbPubResult.ok) {
                backupContent = fbResult.content;
                // v8.8.0: Mark as "backup" (not "published" or "failed").
                if (this.deps.strategyEngine) {
                  await this.deps.strategyEngine.markPostBackup(slot.date, slot.index).catch(() => {});
                }
                // Send admin notification about the backup.
                const adminId = this.deps.adminId?.() ?? 0;
                if (adminId > 0 && this.deps.tg) {
                  await this.deps.tg.sendMessage(adminId, [
                    `╔══════════════════════════╗`,
                    `   🔄 BACKUP POST PUBLISHED`,
                    `╚══════════════════════════╝`,
                    ``,
                    `<blockquote>📅 <b>Slot:</b> ${slot.date} at ${slot.time}</blockquote>`,
                    `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
                    `<blockquote>❌ <b>Original failed:</b> ${escapeHtml(result.error ?? "unknown")}</blockquote>`,
                    `<blockquote>✅ <b>Backup plugin:</b> ${fbPlugin}</blockquote>`,
                    `<blockquote>📤 <b>Channel Msg ID:</b> <code>${fbPubResult.telegramMessageId}</code></blockquote>`,
                  ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
                }
                // Return the backup result.
                await this.deps.dailyPlanner.markSlotFired(slot, fbResult.content.id);
                return {
                  ok: true,
                  contentId: fbResult.content.id,
                  category: slot.category,
                  telegramMessageId: fbPubResult.telegramMessageId,
                  telegramChatId: fbPubResult.telegramChatId,
                  publishedAt: Date.now(),
                  attempts: 1,
                };
              }
            }
          } catch (e) {
            this.deps.logger.warn("source.fetch_error", {
              fallbackPlugin: fbPlugin,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // No backup succeeded — mark as failed.
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index).catch((e: unknown) => {
            this.deps.logger.warn("scheduler.skip", {
              slotIndex: slot.index,
              error: e instanceof Error ? e.message : String(e),
              message: "markPostFailed failed",
            });
          });
        }

        // Send failure report to admin.
        const adminId = this.deps.adminId?.() ?? 0;
        if (adminId > 0 && this.deps.tg) {
          await this.deps.tg.sendMessage(adminId, [
            `╔══════════════════════════╗`,
            `   ❌ POST FAILED (NO BACKUP)`,
            `╚══════════════════════════╝`,
            ``,
            `<blockquote>📅 <b>Slot:</b> ${slot.date} at ${slot.time}</blockquote>`,
            `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
            `<blockquote>❌ <b>Error:</b> ${escapeHtml(result.error ?? "unknown")}</blockquote>`,
            `<blockquote>⚠️ <b>All fallback plugins also failed.</b></blockquote>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }

        return result;
      }

      // v8.2.1: Update strategy plan status too.
      if (this.deps.strategyEngine) {
        if (result.ok) {
          await this.deps.strategyEngine.markPostPublished(slot.date, slot.index).catch((e: unknown) => {
            this.deps.logger.warn("scheduler.skip", {
              slotIndex: slot.index,
              error: e instanceof Error ? e.message : String(e),
              message: "markPostPublished failed",
            });
          });
        } else {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index).catch((e: unknown) => {
            this.deps.logger.warn("scheduler.skip", {
              slotIndex: slot.index,
              error: e instanceof Error ? e.message : String(e),
              message: "markPostFailed failed",
            });
          });
        }
      }

      // 5. Notify admin PM — ALWAYS, both on success and on failure.
      //    The previous code only notified on success (result.ok), which
      //    meant queued posts that failed quality gate / sendPhoto /
      //    sendMessage silently disappeared with no admin visibility.
      //    Now: on success, send the post + summary. On failure, send
      //    the formatted post + error notice (so admin can see what
      //    would have been published and decide whether to forward it).
      if (result.ok) {
        this.consecutiveFailures = 0; // reset failure counter on success.
      } else {
        this.consecutiveFailures++;
      }
      await this.notifyAdminPm(content, result, slot).catch((err) => {
        // Last-resort: try a plain text notice so the admin at least
        // knows something went wrong, even if the formatted post failed.
        this.deps.logger.warn("scheduler.admin_pm_failed", {
          contentId: content.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error("pipeline.error", {
        slotIndex: slot.index,
        contentId: content.id,
        error: message,
        message: "Publish failed",
      });
      // Mark slot as fired to prevent infinite retry loop.
      await this.deps.dailyPlanner.markSlotFired(slot, "publish-error").catch(() => {});

      // Track consecutive failures and alert admin.
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        const adminId = this.deps.adminId?.() ?? 0;
        if (adminId > 0 && this.deps.tg) {
          await this.deps.tg.sendMessage(adminId, [
            `⚠️ <b>Scheduler: 3 consecutive failures</b>`,
            ``,
            `<b>Last error:</b> ${escapeHtml(message)}`,
            `<b>Slot:</b> ${slot.date} ${slot.time} (cat ${slot.category})`,
            `<b>Content ID:</b> <code>${escapeHtml(content.id)}</code>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
        // Reset to avoid spamming.
        this.consecutiveFailures = 0;
      }

      // Move content to DLQ.
      // (The publishing service already recorded the failure in history.)

      return {
        ok: false,
        contentId: content.id,
        category: slot.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: message,
        attempts: 0,
      };
    }
  }

  /**
   * Send the formatted post + a summary notification to the admin PM.
   * Mirrors what the manual publish path (admin/screens/manual.ts and
   * entry/manager.ts post/channel) does. Failures here are logged but
   * do not raise — the publish result is already determined.
   *
   * Behavior:
   *   - On success: send the formatted post (photo or text) + summary.
   *   - On failure: send the formatted post (so admin can forward it
   *     manually) + an error notice with the failure reason.
   *   - If sendPhoto fails: fall back to text-only (same content).
   *   - If sendMessage fails on the formatted post: send a plain-text
   *     fallback with just the headline + URL so the admin at least
   *     sees *something*.
   */
  private async notifyAdminPm(
    content: ReadyContent,
    pubResult: PublishResult,
    slot: SlotTime,
  ): Promise<void> {
    const adminId = this.deps.adminId?.() ?? 0;
    if (adminId <= 0 || !this.deps.tg || !this.deps.uxLayer) return;

    // 1. Build the formatted post.
    let finalPost;
    try {
      finalPost = await this.deps.uxLayer.transform(content);
    } catch (err) {
      // If even the transform fails, send a minimal plain-text notice.
      this.deps.logger.warn("scheduler.transform_failed", {
        contentId: content.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.deps.tg.sendMessage(adminId, [
        `╔══════════════════════════╗`,
        `   🤖 AUTO-PUBLISH NOTICE`,
        `╚══════════════════════════╝`,
        ``,
        `<blockquote>📅 <b>Scheduled:</b> ${slot.date} at ${slot.time}</blockquote>`,
        `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
        `<blockquote>📰 <b>Headline:</b> ${escapeHtml(content.headline ?? "(none)")}</blockquote>`,
        `<blockquote>🔗 <b>Source:</b> ${escapeHtml(content.sourceUrl ?? "(none)")}</blockquote>`,
        pubResult.ok
          ? `<blockquote>✅ <b>Channel Message ID:</b> <code>${pubResult.telegramMessageId}</code></blockquote>`
          : `<blockquote>❌ <b>Error:</b> ${escapeHtml(pubResult.error ?? "unknown")}</blockquote>`,
      ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
      return;
    }

    // 2. Send the formatted post (photo or text). Fall back to text-only
    //    if sendPhoto fails.
    const sentPostNotice = pubResult.ok
      ? "🤖 <b>📤 Auto-Published Post — Copy of Channel Message:</b>"
      : "⚠️ <b>Auto-Publish FAILED — Post for Manual Forwarding:</b>";

    try {
      if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
        await this.deps.tg.sendPhoto(adminId, finalPost.media.url, finalPost.caption, {
          parse_mode: "HTML",
        });
      } else {
        await this.deps.tg.sendMessage(adminId, `${sentPostNotice}\n\n${finalPost.fullText}`, {
          parse_mode: "HTML",
        });
      }
    } catch (err) {
      this.deps.logger.warn("scheduler.send_formatted_failed", {
        contentId: content.id,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        if (finalPost.media && finalPost.media.type === "image") {
          await this.deps.tg.sendMessage(adminId, `${sentPostNotice}\n\n${finalPost.fullText}`, {
            parse_mode: "HTML",
          });
        }
      } catch { /* non-fatal */ }
    }

    // 3. Send the summary report with professional UI.
    const statusBanner = pubResult.ok
      ? `╔══════════════════════════╗\n   ✅ AUTO-PUBLISHED SUCCESSFULLY\n╚══════════════════════════╝`
      : `╔══════════════════════════╗\n   ❌ AUTO-PUBLISH FAILED\n╚══════════════════════════╝`;

    const qualityEmoji = content.quality.overallScore >= 80 ? "🟢" : content.quality.overallScore >= 60 ? "🟡" : "🔴";

    await this.deps.tg.sendMessage(adminId, [
      statusBanner,
      ``,
      `<blockquote>📅 <b>Scheduled:</b> ${slot.date} at ${slot.time}</blockquote>`,
      `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
      `<blockquote>🔌 <b>Source Plugin:</b> ${escapeHtml(content.pluginId)}</blockquote>`,
      `<blockquote>🤖 <b>AI Model:</b> ${escapeHtml(content.aiProvider)}/${escapeHtml(content.aiModel)}</blockquote>`,
      `<blockquote>${qualityEmoji} <b>Quality Score:</b> ${content.quality.overallScore}/100</blockquote>`,
      `<blockquote>📊 <b>Tokens Used:</b> ${content.tokensUsed}</blockquote>`,
      `<blockquote>🔖 <b>Content ID:</b> <code>${escapeHtml(content.id)}</code></blockquote>`,
      pubResult.ok
        ? `<blockquote>📤 <b>Channel Message ID:</b> <code>${pubResult.telegramMessageId}</code></blockquote>`
        : `<blockquote>⚠️ <b>Error:</b> ${escapeHtml(pubResult.error ?? "unknown")}</blockquote>`,
    ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
  }

  /**
   * v8.1.3: Notify admin when a scheduled post FAILS to publish.
   * Sends a report with the failure reason + the source item info (if available)
   * so the admin can see what would have been published and decide whether
   * to manually trigger it.
   */
  /**
   * v8.4.0: Get fallback plugins for a category — used when the primary
   * plugin fails to produce content. Returns all plugins for the category
   * from CATEGORY_PROVIDERS (excluding the one that already failed, which
   * is handled by the caller).
   */
  private getFallbackPlugins(category: Category): string[] {
    const providers: Record<string, readonly string[]> = {
      A: ["github", "github-trending", "github-releases", "devto", "stackexchange"],
      B: ["news", "hackernews"],
      C: ["nasa", "xkcd", "wikimedia", "joke", "reddit"],
    };
    return [...(providers[category] ?? [])];
  }

  private async notifyAdminOfFailure(
    slot: SlotTime,
    error: string,
    item?: { id?: string; title?: string; url?: string; source?: string } | null,
  ): Promise<void> {
    const adminId = this.deps.adminId?.() ?? 0;
    if (adminId <= 0 || !this.deps.tg) return;

    const statusBanner = `╔══════════════════════════╗\n   ⚠️ SCHEDULED POST FAILED\n╚══════════════════════════╝`;

    const lines = [
      statusBanner,
      ``,
      `<blockquote>📅 <b>Scheduled:</b> ${slot.date} at ${slot.time}</blockquote>`,
      `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
      `<blockquote>❌ <b>Error:</b> ${escapeHtml(error)}</blockquote>`,
    ];

    if (item) {
      lines.push(``);
      lines.push(`<blockquote>📰 <b>Title:</b> ${escapeHtml(item.title ?? "(none)")}</blockquote>`);
      if (item.source) {
        lines.push(`<blockquote>🔌 <b>Source:</b> ${escapeHtml(item.source)}</blockquote>`);
      }
      if (item.url) {
        lines.push(`<blockquote>🔗 <b>URL:</b> ${escapeHtml(item.url)}</blockquote>`);
      }
      if (item.id) {
        lines.push(`<blockquote>🔖 <b>Content ID:</b> <code>${escapeHtml(item.id)}</code></blockquote>`);
      }
    }

    lines.push(``);
    lines.push(`<blockquote>💡 <i>The admin can manually trigger a post from the bot if desired.</i></blockquote>`);

    await this.deps.tg.sendMessage(adminId, lines.join("\n"), {
      parse_mode: "HTML",
    }).catch(() => {});
  }

  /**
   * Manual publish — publish a specific category, plugin, or random.
   */
  async manualPublish(options: ManualPublishOptions): Promise<PublishResult> {
    const settings = await this.deps.settings();

    // 1. Determine what to publish.
    let pipelineResult;
    if (options.source) {
      // Publish from a specific plugin.
      pipelineResult = await this.deps.contentManager.processFromPlugin(
        options.source,
        options.language ?? settings.language.default,
        { skipEnqueue: true },
      );
    } else if (options.category) {
      // Publish a specific category.
      pipelineResult = await this.deps.contentManager.processForCategory(
        options.category,
        null,
        options.language ?? settings.language.default,
        { skipEnqueue: true },
      );
    } else {
      // Publish random — pick a random enabled category.
      const categories: Category[] = ["A", "B", "C"];
      const enabled = categories.filter((c) => settings.categories[c]?.enabled);
      if (enabled.length === 0) {
        return {
          ok: false,
          contentId: null,
          category: null,
          telegramMessageId: null,
          telegramChatId: null,
          publishedAt: Date.now(),
          error: "No enabled categories",
          attempts: 0,
        };
      }
      const randomCat = enabled[Math.floor(Math.random() * enabled.length)]!;
      pipelineResult = await this.deps.contentManager.processForCategory(
        randomCat,
        null,
        options.language ?? settings.language.default,
        { skipEnqueue: true },
      );
    }

    if (!pipelineResult.ok || !pipelineResult.content) {
      return {
        ok: false,
        contentId: null,
        category: options.category ?? null,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: pipelineResult.error ?? "Pipeline failed",
        attempts: 0,
      };
    }

    // 2. Simulate mode — don't actually publish.
    if (options.simulate) {
      this.deps.logger.info("scheduler.slot_fired", {
        contentId: pipelineResult.content.id,
        simulate: true,
        message: "Simulated publish (no Telegram call)",
      });
      return {
        ok: true,
        contentId: pipelineResult.content.id,
        category: pipelineResult.content.category,
        telegramMessageId: 0,
        telegramChatId: "simulated",
        publishedAt: Date.now(),
        attempts: 0,
      };
    }

    // 3. Publish for real.
    try {
      return await this.deps.publishingService.publish(pipelineResult.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        contentId: pipelineResult.content.id,
        category: pipelineResult.content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: message,
        attempts: 0,
      };
    }
  }

  /** Get scheduler status (for the dashboard). */
  async status(): Promise<SchedulerStatus> {
    const settings = await this.deps.settings();
    let plan: DailyPlan | null = null;
    let nextSlot: SlotTime | null = null;

    try {
      // v8.5.0: Use strategyEngine plan if available — same plan as Daily Plan table.
      if (this.deps.strategyEngine) {
        const stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
        plan = {
          date: stratPlan.date,
          slots: stratPlan.posts.map(p => ({
            index: p.index,
            date: p.date,
            time: p.time,
            epochMs: p.epochMs,
            category: p.category,
            jitterMinutes: 0,
            fired: p.status === "published" || p.status === "failed" || p.status === "backup",
            status: p.status, // v8.7.0: carry real 3-state status
          })),
          generatedAt: stratPlan.generatedAt,
          timezone: stratPlan.timezone,
          postsPerDay: stratPlan.posts.length,
          categoryDistribution: { A: 0, B: 0, C: 0 },
        };
        for (const p of stratPlan.posts) {
          const dist = plan!.categoryDistribution as Record<string, number>;
          dist[p.category] = (dist[p.category] ?? 0) + 1;
        }
      } else {
        plan = await this.deps.dailyPlanner.getOrGenerate();
      }
      const next = await this.deps.dailyPlanner.getNextSlot();
      nextSlot = next?.slot ?? null;
    } catch { /* non-fatal */
      // Plan generation failed — return disabled-like status.
    }

    const queueDepths = await this.deps.contentQueue.depth();
    const totalQueue = queueDepths.reduce((sum, q) => sum + q.depth, 0);

    // Load today's history for published counts.
    const todayHistory = await this.deps.history.getToday().catch(() => ({ entries: [] }));
    const published = todayHistory.entries.filter((e) => e.telegramMessageId > 0);
    const postsByCategory: Record<Category, number> = { A: 0, B: 0, C: 0 };
    for (const entry of published) {
      postsByCategory[entry.category] = (postsByCategory[entry.category] ?? 0) + 1;
    }
    const lastPublished = published[0]?.publishedAt ?? null;

    // v8.5.0: If using dailyPlanner (not strategyEngine), annotate slots with fired state.
    // If using strategyEngine, slots already have fired state from the plan status.
    if (plan && !this.deps.strategyEngine) {
      const annotatedSlots = await Promise.all(
        plan.slots.map(async (s) => {
          const fired = await this.deps.dailyPlanner.isSlotFired(s);
          return { ...s, fired };
        }),
      );
      plan = { ...plan, slots: annotatedSlots };
    }

    return {
      enabled: settings.scheduler.enabled,
      today: plan,
      nextSlot,
      queueDepth: totalQueue,
      lastFiredAt: lastPublished,
      postsPublishedToday: published.length,
      postsByCategoryToday: postsByCategory,
    };
  }

  /** Check if the scheduler is enabled. */
  async isEnabled(): Promise<boolean> {
    const settings = await this.deps.settings();
    return settings.scheduler.enabled;
  }

  /** Enable the scheduler. */
  async enable(): Promise<void> {
    const settings = await this.deps.settings();
    if (settings.scheduler.enabled) return;
    // Update via config service — but we don't have direct access here.
    // The admin screen handles the actual config update.
    // This method is a placeholder for programmatic enable.
    throw new SchedulerDisabledError("Use the admin panel to enable the scheduler");
  }

  /** Generate a new daily plan (for testing or admin trigger). */
  async generatePlan(): Promise<DailyPlan> {
    return this.deps.dailyPlanner.generate();
  }

  /** Get the job queue (for the dashboard). */
  async getJobs() {
    return this.deps.jobQueue.list();
  }
}

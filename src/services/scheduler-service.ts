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
import { reportBanner, reportRow, qualityRow } from "../primitives/report";

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
  /** v9.2.3: KV store — used for the always-on failure ring buffer.
   *  Optional for backward compat (tests that don't pass kv will simply
   *  skip the failure buffer). */
  readonly kv?: import("./kv-store").KVStore;
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

    // 3. v11.11.0: Window-based scheduling — find the OLDEST pending due slot.
    //    Only fire ONE slot per tick to prevent burst publishing.
    //    If a slot was missed (cron gap), it fires on the next tick.
    //    Random slot times are preserved — the scheduler adapts to them.
    this.deps.logger.info("scheduler.tick", {
      now: new Date(now).toISOString(),
      nowEpoch: now,
      timezone: settings.scheduler.timezone,
      slots: plan.slots.map((s) => ({
        index: s.index,
        time: s.time,
        epochMs: s.epochMs,
        isDue: s.epochMs <= now,
        overdueMin: s.epochMs <= now ? Math.round((now - s.epochMs) / 60000) : 0,
      })),
      message: "Scheduler tick — checking slots",
    });

    const dueSlot = await this.findDueSlot(plan, now);
    if (!dueSlot) {
      this.deps.logger.info("scheduler.skip", {
        reason: "no_due_slots",
        slotsChecked: plan.slots.length,
        message: "No due slots found",
      });
      return {
        fired: false,
        slot: null,
        job: null,
        published: null,
        skipped: true,
        skipReason: "No due slots",
      };
    }

    // 4. Fire the oldest pending due slot.
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

  /**
   * v11.11.0: Find the OLDEST pending due slot within the grace period.
   *
   * Architecture change:
   * - v11.2.0 fired ALL due slots (could cause burst publishing)
   * - v11.11.0 fires ONE slot per tick (oldest first)
   *
   * This ensures:
   * - Random slot times are preserved (no bias needed)
   * - One post per cron tick (no burst)
   * - Missed slots fire on next tick (grace period)
   * - No duplicate publishing
   *
   * The scheduler adapts to the random slot times, NOT the other way around.
   */
  private async findDueSlot(plan: DailyPlan, now: number): Promise<SlotTime | null> {
    const GRACE_PERIOD_MS = 240 * 60 * 1000; // 4 hours

    let stratPlan: import("../types/strategy").DailyPublishPlan | null = null;
    if (this.deps.strategyEngine) {
      try {
        stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
      } catch { /* non-fatal */ }
    }

    // Iterate slots in chronological order (oldest first).
    // Return the FIRST pending due slot — one per tick.
    for (const slot of plan.slots) {
      // Skip slots not yet due.
      if (slot.epochMs > now) {
        continue;
      }

      // Check if already fired.
      let alreadyFired = false;
      if (stratPlan) {
        const post = stratPlan.posts.find(p => p.index === slot.index);
        if (post && (post.status === "published" || post.status === "failed" || post.status === "backup" || post.status === "publishing")) {
          alreadyFired = true;
        }
      } else {
        alreadyFired = await this.deps.dailyPlanner.isSlotFired(slot);
      }
      if (alreadyFired) continue;

      // Grace period — if slot is too far overdue, mark as failed.
      if (now - slot.epochMs > GRACE_PERIOD_MS) {
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
            error: `Slot >4h overdue — grace period exceeded. Now=${new Date(now).toISOString()}, scheduled=${new Date(slot.epochMs).toISOString()}`,
            stage: "grace",
            plugin: null,
          }).catch(() => {});
        } else {
          await this.deps.dailyPlanner.markSlotFired(slot, "passed-grace").catch(() => {});
        }
        this.deps.logger.warn("scheduler.skip", {
          slotIndex: slot.index,
          date: slot.date,
          time: slot.time,
          reason: "slot_overdue_grace",
          overdueHours: Math.round((now - slot.epochMs) / (60 * 60 * 1000) * 10) / 10,
          message: "Slot >4h overdue — marking as passed",
        });
        await this.notifyAdminOfGraceFailure(slot, now).catch(() => {});
        continue;
      }

      // Found the oldest pending due slot — return it.
      this.deps.logger.info("scheduler.slot_fired", {
        slotIndex: slot.index,
        time: slot.time,
        category: slot.category,
        overdue: Math.round((now - slot.epochMs) / 60000) + "min",
        message: `Firing slot ${slot.index} (${slot.time}, ${Math.round((now - slot.epochMs) / 60000)}min overdue)`,
      });
      return slot;
    }
    return null;
  }

  /**
   * v11.2.0: Notify admin when a slot exceeds the grace period and is permanently lost.
   * Previously this was silent — the admin had no idea a post was missed.
   */
  private async notifyAdminOfGraceFailure(slot: SlotTime, now: number): Promise<void> {
    try {
      const settings = await this.deps.settings();
      const adminId = Number(settings.telegram.adminId || 0);
      if (adminId <= 0) return;

      const overdueHours = Math.round((now - slot.epochMs) / (60 * 60 * 1000) * 10) / 10;
      const msg = [
        ``,
        `<b>━━━ ⚠️ SLOT MISSED (Grace Expired) ━━━</b>`,
        ``,
        `<blockquote>📅 <b>Slot:</b> #${slot.index} at ${slot.time}</blockquote>`,
        `<blockquote>📂 <b>Category:</b> ${slot.category}</blockquote>`,
        `<blockquote>⏰ <b>Overdue:</b> ${overdueHours}h</blockquote>`,
        `<blockquote>💡 <b>Cause:</b> External cron gap exceeded 4h grace period</blockquote>`,
      ].join("\n");

      await this.deps.tg?.sendMessage(adminId, msg, { parse_mode: "HTML" }).catch(() => {});
    } catch {
      // non-fatal — notification is best-effort
    }
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
          const failError = pipelineResult.error ?? "Pipeline failed (no fallback content)";
          const failStage = pipelineResult.stage ?? "pipeline";
          const failPlugin = pipelineResult.item?.pluginId ?? slot.category;
          await this.notifyAdminOfFailure(slot, failError, failItem, { stage: failStage, plugin: failPlugin }).catch(() => {});

          // v8.2.1: Mark strategy plan post as failed too.
          // v9.2.3: Pass the real error info so the Manager UI can show it.
          if (this.deps.strategyEngine) {
            await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
              error: failError,
              stage: failStage,
              plugin: failPlugin,
            }).catch(() => {});
          }

          // v9.2.3: Record in the always-on failure ring buffer.
          await this.recordFailure({
            slot,
            error: failError,
            stage: failStage,
            plugin: failPlugin,
            contentId: pipelineResult.item?.id ?? null,
          }).catch(() => {});

          // Mark slot as fired (to avoid retrying with no content).
          if (!this.deps.strategyEngine) {
          await this.deps.dailyPlanner.markSlotFired(slot, "no-content");
        }

          return {
            ok: false,
            contentId: null,
            category: slot.category,
            telegramMessageId: null,
            telegramChatId: null,
            publishedAt: Date.now(),
            error: failError,
            attempts: 0,
          };
        }
      } else {
        content = pipelineResult.content;
      }
    }

    // 3. Publish.
    // v11.2.0: Write "publishing" marker BEFORE publish to prevent duplicates
    // on crash. If the Worker crashes between publish() returning and
    // markPostPublished() writing, the next tick sees "publishing" and skips.
    if (this.deps.strategyEngine) {
      await this.deps.strategyEngine.markPostPublishing(slot.date, slot.index).catch(() => {});
    }
    try {
      const result = await this.deps.publishingService.publish(content);

      // 4. Mark slot as fired (success or failure — prevents infinite retry).
      if (!this.deps.strategyEngine) {
        await this.deps.dailyPlanner.markSlotFired(slot, content.id);
      }

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
                // v9.2.3: Pass the original error so admin can see why primary failed.
                if (this.deps.strategyEngine) {
                  await this.deps.strategyEngine.markPostBackup(slot.date, slot.index, {
                    error: result.error ?? "unknown",
                    stage: "publish",
                    plugin: content.pluginId,
                  }).catch(() => {});
                }
                // v9.3.1: Record the primary's failure in the always-on ring buffer
                // so it shows up in the Manager Logs tab.
                await this.recordFailure({
                  slot,
                  error: result.error ?? "unknown",
                  stage: "publish",
                  plugin: content.pluginId,
                  contentId: content.id,
                }).catch(() => {});
                // v9.3.1: Record the BACKUP content in dedup (it was successfully published).
                if (this.deps.duplicateDetector) {
                  await this.deps.duplicateDetector.recordPublished(fbResult.content).catch(() => {});
                }
                // Send admin notification about the backup.
                const adminId = this.deps.adminId?.() ?? 0;
                if (adminId > 0 && this.deps.tg) {
                  // v9.3.1: Also send the formatted backup post to admin PM
                  // (previously only the summary was sent, not the actual post).
                  try {
                    if (this.deps.uxLayer) {
                      const backupPost = await this.deps.uxLayer.transform(fbResult.content);
                      if (backupPost.media && backupPost.media.type === "image" && backupPost.media.url) {
                        await this.deps.tg.sendPhoto(adminId, backupPost.media.url, backupPost.caption, {
                          parse_mode: "HTML",
                        }).catch(() => {});
                      } else {
                        await this.deps.tg.sendMessage(adminId, backupPost.fullText, {
                          parse_mode: "HTML",
                        }).catch(() => {});
                      }
                    }
                  } catch { /* non-fatal */ }
                  // Send the backup summary notification.
                  await this.deps.tg.sendMessage(adminId, [
                    ``,
                    reportBanner("🔄", "BACKUP POST PUBLISHED"),
                    ``,
                    ``,
                    reportRow("📅", "Slot", `${slot.date} at ${slot.time}`),
                    reportRow("🏷️", "Category", slot.category),
                    reportRow("❌", "Original failed", result.error ?? "unknown"),
                    reportRow("🔌", "Original plugin", content.pluginId),
                    reportRow("✅", "Backup plugin", fbPlugin),
                    qualityRow(fbResult.content.quality.overallScore),
                    reportRow("📤", "Channel Msg ID", String(fbPubResult.telegramMessageId)),
                    reportRow("🔖", "Content ID", fbResult.content.id),
                  ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
                }
                // Return the backup result.
                if (!this.deps.strategyEngine) {
                  await this.deps.dailyPlanner.markSlotFired(slot, fbResult.content.id);
                }
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
        // v9.2.3: Capture the original error AND the fallback attempts.
        const finalError = result.error ?? "All plugins failed (primary + fallbacks)";
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
            error: finalError,
            stage: "publish",
            plugin: content.pluginId,
          }).catch((e: unknown) => {
            this.deps.logger.warn("scheduler.skip", {
              slotIndex: slot.index,
              error: e instanceof Error ? e.message : String(e),
              message: "markPostFailed failed",
            });
          });
        }

        // v9.2.3: Record in the always-on failure ring buffer.
        await this.recordFailure({
          slot,
          error: finalError,
          stage: "publish",
          plugin: content.pluginId,
          contentId: content.id,
        }).catch(() => {});

        // Send failure report to admin.
        const adminId = this.deps.adminId?.() ?? 0;
        if (adminId > 0 && this.deps.tg) {
          await this.deps.tg.sendMessage(adminId, [
            ``,
            `<b>━━━ ❌ POST FAILED ━━━</b>`,
            ``,
            ``,
            `<blockquote>📅 <b>Slot:</b> ${slot.date} at ${slot.time}</blockquote>`,
            `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
            `<blockquote>🔌 <b>Original plugin:</b> ${escapeHtml(content.pluginId)}</blockquote>`,
            `<blockquote>🔖 <b>Content ID:</b> <code>${escapeHtml(content.id)}</code></blockquote>`,
            `<blockquote>❌ <b>Error:</b> ${escapeHtml(finalError)}</blockquote>`,
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
          // v9.3.1: Record in dedup store ONLY after successful publish.
          // Previously this was done in content-manager.ts before enqueue,
          // causing unpublished posts to be falsely detected as duplicates.
          if (this.deps.duplicateDetector) {
            await this.deps.duplicateDetector.recordPublished(content).catch(() => {});
          }
        } else {
          // v9.2.3: Pass real error info to markPostFailed.
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
            error: result.error ?? "unknown",
            stage: "publish",
            plugin: content.pluginId,
          }).catch((e: unknown) => {
            this.deps.logger.warn("scheduler.skip", {
              slotIndex: slot.index,
              error: e instanceof Error ? e.message : String(e),
              message: "markPostFailed failed",
            });
          });
          // v9.2.3: Record in the always-on failure ring buffer (for cases
          // where we got here without going through the fallback branch above).
          await this.recordFailure({
            slot,
            error: result.error ?? "unknown",
            stage: "publish",
            plugin: content.pluginId,
            contentId: content.id,
          }).catch(() => {});
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
      if (!this.deps.strategyEngine) {
        await this.deps.dailyPlanner.markSlotFired(slot, "publish-error").catch(() => {});
      }

      // v8.10.0: If KV quota exceeded, notify admin immediately.
      if (message.includes("KV put() limit") || message.includes("quota")) {
        const adminId = this.deps.adminId?.() ?? 0;
        if (adminId > 0 && this.deps.tg) {
          await this.deps.tg.sendMessage(adminId, [
            ``,
            `<b>━━━ ⚠️ KV QUOTA EXCEEDED ━━━</b>`,
            ``,
            ``,
            `<blockquote>📅 <b>Slot:</b> ${slot.date} at ${slot.time}</blockquote>`,
            `<blockquote>❌ <b>Error:</b> ${escapeHtml(message)}</blockquote>`,
            `<blockquote>💡 <b>Action:</b> KV daily write limit exceeded. Publishing will resume after midnight UTC reset.</blockquote>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
        // Mark strategy plan as failed too.
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
            error: message,
            stage: "publish",
            plugin: content.pluginId,
          }).catch(() => {});
        }
        // v9.2.3: Record in the always-on failure ring buffer.
        await this.recordFailure({
          slot,
          error: message,
          stage: "publish",
          plugin: content.pluginId,
          contentId: content.id,
        }).catch(() => {});
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
        ``,
        `<b>━━━ 🤖 AUTO-PUBLISH NOTICE ━━━</b>`,
        ``,
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
      ? "<b>━━━ 🤖 📤 AUTO-PUBLISHED POST ━━━</b>\n\n<i>Copy of the channel post:</i>"
      : "<b>━━━ ⚠️ AUTO-PUBLISH FAILED ━━━</b>\n\n<i>Formatted post for manual forwarding:</i>";

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
      ? reportBanner("✅", "AUTO-PUBLISHED")
      : reportBanner("❌", "AUTO-PUBLISH FAILED");

    await this.deps.tg.sendMessage(adminId, [
      statusBanner,
      ``,
      reportRow("📅", "Scheduled", `${slot.date} at ${slot.time}`),
      reportRow("🏷️", "Category", slot.category),
      reportRow("🔌", "Source Plugin", content.pluginId),
      reportRow("🤖", "AI Model", `${content.aiProvider}/${content.aiModel}`),
      qualityRow(content.quality.overallScore),
      reportRow("📊", "Tokens Used", String(content.tokensUsed)),
      reportRow("🔖", "Content ID", content.id),
      pubResult.ok
        ? reportRow("📤", "Channel Message ID", String(pubResult.telegramMessageId))
        : reportRow("⚠️", "Error", pubResult.error ?? "unknown"),
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
    errorInfo?: { stage?: string; plugin?: string | null } | null,
  ): Promise<void> {
    const adminId = this.deps.adminId?.() ?? 0;
    if (adminId <= 0 || !this.deps.tg) return;

    const lines: string[] = [
      reportBanner("⚠️", "SCHEDULED POST FAILED"),
      ``,
      reportRow("📅", "Scheduled", `${slot.date} at ${slot.time}`),
      reportRow("🏷️", "Category", slot.category),
      reportRow("❌", "Error", error),
    ];

    // v9.2.3: Show pipeline stage + plugin if known.
    if (errorInfo?.stage) {
      lines.push(reportRow("🩺", "Failed stage", errorInfo.stage));
    }
    if (errorInfo?.plugin) {
      lines.push(reportRow("🔌", "Plugin attempted", errorInfo.plugin));
    }

    if (item) {
      lines.push(``);
      lines.push(reportRow("📰", "Title", item.title ?? "(none)"));
      if (item.source) {
        lines.push(reportRow("🔌", "Source", item.source));
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

  // ────────────────────────────────────────────────────────────
  // v9.2.3: Always-on failure ring buffer
  // ────────────────────────────────────────────────────────────

  /** v9.2.3: KV key for the always-on failure ring buffer. This buffer is
   *  INDEPENDENT of DEBUG_MODE — failures are always recorded so the admin
   *  can see them in the Manager Logs tab even when debug mode is off.
   *  Capped at 30 entries (oldest evicted on overflow). 7-day TTL. */
  private static readonly FAILURE_BUFFER_KEY = "fredy:debug:failures";
  private static readonly FAILURE_BUFFER_CAP = 30;
  private static readonly FAILURE_BUFFER_TTL = 7 * 24 * 3600; // 7 days

  /** Record a publish failure to the always-on ring buffer. Called from
   *  every failure path in fireSlot(). Never throws — failures here must
   *  not crash the scheduler. */
  private async recordFailure(info: {
    slot: SlotTime;
    error: string;
    stage: string;
    plugin: string | null;
    contentId: string | null;
  }): Promise<void> {
    try {
      const kv = this.deps.kv;
      if (!kv) return; // No KV wired — silently skip (test environments).
      const entry = {
        time: Date.now(),
        slotIndex: info.slot.index,
        date: info.slot.date,
        slotTime: info.slot.time,
        category: info.slot.category,
        error: info.error,
        stage: info.stage,
        plugin: info.plugin,
        contentId: info.contentId,
      };
      const existing = await kv.getJson<unknown[]>(SchedulerService.FAILURE_BUFFER_KEY);
      const list = Array.isArray(existing) ? existing : [];
      list.unshift(entry);
      if (list.length > SchedulerService.FAILURE_BUFFER_CAP) {
        list.length = SchedulerService.FAILURE_BUFFER_CAP;
      }
      await kv.setJson(SchedulerService.FAILURE_BUFFER_KEY, list, SchedulerService.FAILURE_BUFFER_TTL);
    } catch (err) {
      // Never crash the scheduler from a logging failure.
      console.error("[scheduler] recordFailure failed:", err instanceof Error ? err.message : err);
    }
  }

  /** v9.2.3: Read the always-on failure ring buffer. Exposed for the
   *  Manager UI via container.scheduler.getRecentFailures(). */
  async getRecentFailures(): Promise<readonly unknown[]> {
    try {
      const kv = this.deps.kv;
      if (!kv) return [];
      const existing = await kv.getJson<unknown[]>(SchedulerService.FAILURE_BUFFER_KEY);
      return Array.isArray(existing) ? existing : [];
    } catch {
      return [];
    }
  }

  /** v9.2.3: Clear the failure ring buffer. */
  async clearFailures(): Promise<void> {
    try {
      const kv = this.deps.kv;
      if (!kv) return;
      await kv.delete(SchedulerService.FAILURE_BUFFER_KEY);
    } catch { /* non-fatal */ }
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
      // v11.2.0: Fixed dashboard "Next slot" — previously used legacy
      // dailyPlanner.getNextSlot() which reads a DIFFERENT plan than the
      // scheduler uses. Now reads from the strategy plan (the same plan
      // the scheduler fires from) so the dashboard matches reality.
      if (this.deps.strategyEngine) {
        try {
          const stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
          const now = Date.now();
          const nextPost = stratPlan.posts.find((p) =>
            p.status === "pending" && p.epochMs > now,
          );
          if (nextPost) {
            nextSlot = {
              index: nextPost.index,
              date: nextPost.date,
              time: nextPost.time,
              epochMs: nextPost.epochMs,
              category: nextPost.category,
              jitterMinutes: 0,
            };
          }
        } catch { /* non-fatal */ }
      } else {
        const next = await this.deps.dailyPlanner.getNextSlot();
        nextSlot = next?.slot ?? null;
      }
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

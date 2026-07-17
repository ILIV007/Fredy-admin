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
    let plan: DailyPlan;
    try {
      plan = await this.deps.dailyPlanner.getOrGenerate();
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

  /** Find a due, unfired slot. */
  private async findDueSlot(plan: DailyPlan, now: number): Promise<SlotTime | null> {
    for (const slot of plan.slots) {
      // Check if slot is due (epochMs <= now).
      if (slot.epochMs > now) continue;

      // Check if already fired.
      const fired = await this.deps.dailyPlanner.isSlotFired(slot);
      if (fired) continue;

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
    //    v7.4.2: skipEnqueue=true — this content is about to be published
    //    immediately, so it should NOT also go to the queue (otherwise the
    //    queue fills with already-published posts).
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
          message: "No content available — skipping slot",
        });

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

      content = pipelineResult.content;
    }

    // 3. Publish.
    try {
      const result = await this.deps.publishingService.publish(content);

      // 4. Mark slot as fired (success or failure — prevents infinite retry).
      await this.deps.dailyPlanner.markSlotFired(slot, content.id);

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
            `<b>Last error:</b> ${this.escapeHtml(message)}`,
            `<b>Slot:</b> ${slot.date} ${slot.time} (cat ${slot.category})`,
            `<b>Content ID:</b> <code>${this.escapeHtml(content.id)}</code>`,
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
        `🤖 <b>اعلان انتشار خودکار</b>`,
        ``,
        `<blockquote>📅 <b>زمان:</b> ${slot.date} ${slot.time} (دسته ${slot.category})</blockquote>`,
        `<blockquote>📰 <b>تیتر:</b> ${this.escapeHtml(content.headline ?? "(بدون تیتر)")}</blockquote>`,
        `<blockquote>🔗 <b>منبع:</b> ${this.escapeHtml(content.sourceUrl ?? "(بدون منبع")}</blockquote>`,
        pubResult.ok
          ? `<blockquote>✅ <b>شناسه پیام کانال:</b> ${pubResult.telegramMessageId}</blockquote>`
          : `<blockquote>❌ <b>خطا:</b> ${this.escapeHtml(pubResult.error ?? "نامشخص")}</blockquote>`,
      ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
      return;
    }

    // 2. Send the formatted post (photo or text). Fall back to text-only
    //    if sendPhoto fails.
    //    v7.4.3: Persian labels + blockquote for the header notice.
    const sentPostNotice = pubResult.ok
      ? "🤖 <b>پست خودکار منتشر شد — کپی پیام کانال:</b>"
      : "⚠️ <b>انتشار خودکار ناموفق بود — پست برای ارسال دستی:</b>";

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
      // sendPhoto or sendMessage failed — retry with text-only fallback.
      this.deps.logger.warn("scheduler.send_formatted_failed", {
        contentId: content.id,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        if (finalPost.media && finalPost.media.type === "image") {
          // Photo failed — send as text.
          await this.deps.tg.sendMessage(adminId, `${sentPostNotice}\n\n${finalPost.fullText}`, {
            parse_mode: "HTML",
          });
        }
      } catch { /* non-fatal */
        // Even text-only failed — give up on the formatted post; the
        // summary below will still go out.
      }
    }

    // 3. Send the summary notification — v7.4.3: Persian + blockquote UI.
    //    Each fact is in its own blockquote for a clean, scannable layout.
    const statusLine = pubResult.ok
      ? `✅ <b>انتشار موفقیت‌آمیز بود</b>`
      : `❌ <b>انتشار ناموفق بود</b>`;

    const summaryLines = [
      statusLine,
      ``,
      `<blockquote>📅 <b>زمان:</b> ${slot.date} ${slot.time} | <b>دسته:</b> ${slot.category}</blockquote>`,
      `<blockquote>🤖 <b>هوش مصنوعی:</b> ${this.escapeHtml(content.aiProvider)}/${this.escapeHtml(content.aiModel)}</blockquote>`,
      `<blockquote>🎯 <b>کیفیت:</b> ${content.quality.overallScore} | <b>توکن:</b> ${content.tokensUsed}</blockquote>`,
      `<blockquote>🔖 <b>شناسه محتوا:</b> <code>${this.escapeHtml(content.id)}</code></blockquote>`,
      pubResult.ok
        ? `<blockquote>📤 <b>شناسه پیام کانال:</b> ${pubResult.telegramMessageId}</blockquote>`
        : `<blockquote>⚠️ <b>خطا:</b> ${this.escapeHtml(pubResult.error ?? "نامشخص")}</blockquote>`,
    ];

    await this.deps.tg.sendMessage(adminId, summaryLines.join("\n"), {
      parse_mode: "HTML",
    }).catch(() => {});
  }

  /** Escape HTML special characters for safe Telegram display. */
  private escapeHtml(input: string | null | undefined): string {
    if (input === null || input === undefined) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Manual publish — publish a specific category, plugin, or random.
   */
  async manualPublish(options: ManualPublishOptions): Promise<PublishResult> {
    const settings = await this.deps.settings();

    // v7.4.2: skipEnqueue=true so manual posts don't ALSO go to the queue.
    // Previously, manual publish would call process() which always enqueued,
    // causing the post to appear in the Queue page after sending.
    const pipelineOptions = { skipEnqueue: true };

    // 1. Determine what to publish.
    let pipelineResult;
    if (options.source) {
      // Publish from a specific plugin.
      pipelineResult = await this.deps.contentManager.processFromPlugin(
        options.source,
        options.language ?? settings.language.default,
        pipelineOptions,
      );
    } else if (options.category) {
      // Publish a specific category.
      pipelineResult = await this.deps.contentManager.processForCategory(
        options.category,
        null,
        options.language ?? settings.language.default,
        pipelineOptions,
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
        pipelineOptions,
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
      plan = await this.deps.dailyPlanner.getOrGenerate();
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

    return {
      enabled: settings.scheduler.enabled,
      today: plan ? {
        ...plan,
        slots: await Promise.all(
          plan.slots.map(async (s) => ({
            ...s,
            fired: await this.deps.dailyPlanner.isSlotFired(s),
          })),
        ),
      } : null,
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

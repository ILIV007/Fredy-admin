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
  readonly settings: () => Promise<FredySettings>;
  /**
   * Optional — when provided, every successful auto-publish also sends the
   * formatted post + a notification summary to the admin PM, mirroring the
   * manual publish path. This closes the gap where manual posts reached the
   * admin PM but auto-published posts did not.
   */
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
    // Posts are queued but wait for manual approval via the admin panel.
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
    if (!content) {
      const pipelineResult = await this.deps.contentManager.processForCategory(
        slot.category,
        null, // anti-repeat handled by ContentManager via PluginManager
        settings.language.default,
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

      // 4. Mark slot as fired.
      await this.deps.dailyPlanner.markSlotFired(slot, content.id);

      // 5. Notify admin PM (mirrors the manual publish path).
      //    Only on success, and only when tg + uxLayer + adminId are wired.
      if (result.ok) {
        this.consecutiveFailures = 0; // reset failure counter on success.
        await this.notifyAdminPm(content, result, slot).catch(() => {
          // PM notification failures must not affect the publish result.
        });
      }

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
   * entry/manager.ts post/channel) does. Failures here are swallowed.
   */
  private async notifyAdminPm(
    content: ReadyContent,
    pubResult: PublishResult,
    slot: SlotTime,
  ): Promise<void> {
    const adminId = this.deps.adminId?.() ?? 0;
    if (adminId <= 0 || !this.deps.tg || !this.deps.uxLayer) return;

    // 1. Send the EXACT same formatted post as what went to the channel.
    try {
      const finalPost = await this.deps.uxLayer.transform(content);
      if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
        await this.deps.tg.sendPhoto(adminId, finalPost.media.url, finalPost.caption, {
          parse_mode: "HTML",
        });
      } else {
        await this.deps.tg.sendMessage(adminId, finalPost.fullText, {
          parse_mode: "HTML",
        });
      }
    } catch {
      // transform/send failure must not break the publish flow.
    }

    // 2. Send a short notification summary.
    await this.deps.tg.sendMessage(adminId, [
      `🤖 <b>Auto-published (scheduler)</b>`,
      ``,
      `<b>Slot:</b> ${slot.date} ${slot.time} (cat ${slot.category})`,
      `<b>AI:</b> ${this.escapeHtml(content.aiProvider)}/${this.escapeHtml(content.aiModel)}`,
      `<b>Quality:</b> ${content.quality.overallScore}`,
      `<b>Tokens:</b> ${content.tokensUsed}`,
      `<b>Channel Msg ID:</b> ${pubResult.telegramMessageId}`,
    ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
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

    // 1. Determine what to publish.
    let pipelineResult;
    if (options.source) {
      // Publish from a specific plugin.
      pipelineResult = await this.deps.contentManager.processFromPlugin(
        options.source,
        options.language ?? settings.language.default,
      );
    } else if (options.category) {
      // Publish a specific category.
      pipelineResult = await this.deps.contentManager.processForCategory(
        options.category,
        null,
        options.language ?? settings.language.default,
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
    } catch {
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

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
  /** v12.0.5: Maximum replacement attempts when a candidate is rejected as duplicate. */
  private static readonly MAX_REPLACEMENT_ATTEMPTS = 5;

  constructor(private readonly deps: SchedulerServiceDeps) {}

  /**
   * v12.0.5: Check if a publish failure was caused by duplicate detection.
   * Used to decide whether to retry with a replacement candidate.
   * Returns true for both pre-publish dedup (final-publisher.ts) and
   * pipeline dedup (content-manager.ts) rejections.
   */
  private isDedupFailure(result: PublishResult): boolean {
    if (result.ok) return false;
    const err = (result.error ?? "").toLowerCase();
    // Pre-publish dedup: "Duplicate content (already published as ...)"
    // Pipeline dedup: "duplicate_canonical", "duplicate_url", "duplicate_hash"
    return err.includes("duplicate") || err.includes("already published");
  }

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
        // v12.0.0: FIXED slot conversion — now passes windowEnd + scheduledTime.
        // Previously these were dropped, causing findDueSlot to fall back to
        // "23:59" for windowEnd and windowStart for scheduledTime, breaking
        // the random-jitter trigger and the window expiry calculation.
        plan = {
          date: stratPlan.date,
          slots: stratPlan.posts.map(p => ({
            index: p.index,
            date: p.date,
            time: p.time,                         // Window START
            windowEnd: p.windowEnd ?? p.time,     // v12.0.0: Window END (was missing!)
            scheduledTime: p.scheduledTime ?? p.time, // v12.0.0: Random trigger (was missing!)
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
    // v11.15.0: Log window-based information for debugging.
    this.deps.logger.info("scheduler.tick", {
      now: new Date(now).toISOString(),
      nowEpoch: now,
      timezone: settings.scheduler.timezone,
      windows: plan.slots.map((s) => ({
        index: s.index,
        window: `${s.time}-${s.windowEnd ?? "?"}`,
        category: s.category,
      })),
      message: "Scheduler tick — checking windows",
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
   * v11.15.0: WINDOW-BASED scheduling — the core architectural change.
   *
   * Instead of comparing `now >= slot.epochMs` (which requires exact timestamps),
   * the scheduler now checks if the current time falls WITHIN a posting window.
   *
   * Logic:
   * 1. Convert current time to minutes-since-midnight in the configured timezone.
   * 2. For each window (slot), check if current minutes is within [start, end].
   * 3. If yes AND the window is pending → fire it.
   * 4. Also check PAST windows that are still pending (missed ticks).
   * 5. One post per tick (oldest pending window first).
   *
   * This eliminates:
   * - Grace period failures (windows don't "expire" — they stay pending)
   * - Exact timestamp comparison (no epochMs dependency)
   * - "Slot missed" errors (any tick within or after the window fires it)
   *
   * A window is "due" if:
   * - current time >= window start
   * - AND window is still pending (not published/failed/publishing)
   *
   * A window is "expired" if:
   * - current time > window end + 6 hours (generous buffer for cron gaps)
   * - AND still pending → mark as failed + notify admin
   */
  private async findDueSlot(plan: DailyPlan, now: number): Promise<SlotTime | null> {
    let stratPlan: import("../types/strategy").DailyPublishPlan | null = null;
    if (this.deps.strategyEngine) {
      try {
        stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
      } catch { /* non-fatal */ }
    }

    // Get current time in the configured timezone as minutes-since-midnight.
    const settings = await this.deps.settings();
    const tz = settings.scheduler.timezone || "UTC";
    const nowInTz = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(now));
    const [nowH, nowM] = nowInTz.split(":").map(Number);
    const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

    // v11.15.0: Window expiration — 6 hours after window end.
    // This is very generous: with a 2-hour cron, a window at 08:00-10:00
    // would expire at 16:00 (6h after end). That's 3 missed cron ticks.
    const WINDOW_EXPIRY_HOURS = 6;

    for (const slot of plan.slots) {
      // Parse window start/end as minutes-since-midnight.
      const [startH, startM] = slot.time.split(":").map(Number);
      const [endH, endM] = (slot.windowEnd ?? "23:59").split(":").map(Number);
      const startMin = (startH ?? 0) * 60 + (startM ?? 0);
      const endMin = (endH ?? 23) * 60 + (endM ?? 59);

      // v11.18.0: Parse scheduledTime (random within window) as minutes-since-midnight.
      // This is the REAL publish trigger — not windowStart.
      // If scheduledTime is missing (old plan), fall back to windowStart.
      let scheduledMin = startMin;
      if (slot.scheduledTime) {
        const [sH, sM] = slot.scheduledTime.split(":").map(Number);
        scheduledMin = (sH ?? 0) * 60 + (sM ?? 0);
      }
      // Also check strategy plan for scheduledTime (more reliable).
      if (stratPlan) {
        const post = stratPlan.posts.find(p => p.index === slot.index);
        if (post?.scheduledTime) {
          const [psH, psM] = post.scheduledTime.split(":").map(Number);
          scheduledMin = (psH ?? 0) * 60 + (psM ?? 0);
        }
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

      // v12.0.2: EXACT scheduledTime trigger — no early execution.
      // Previously (v11.18.0–v12.0.1) a 10-minute cron tolerance allowed
      // firing BEFORE scheduledTime, causing dashboard/actual-time mismatch.
      // Now the scheduler fires ONLY when now >= scheduledTime.
      // With a 20-min cron, the actual publish lands on the first tick
      // AT OR AFTER scheduledTime (0-20 min delay). This is the real jitter.
      if (nowMinutes < scheduledMin) {
        // scheduledTime hasn't been reached yet — skip.
        continue;
      }

      // v11.18.0: Window expiry — 6 hours after window END (exclusive).
      const expiryMin = endMin + WINDOW_EXPIRY_HOURS * 60;
      const isExpired = nowMinutes >= expiryMin;

      if (isExpired) {
        // Window is expired — mark as failed.
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
            error: `Window ${slot.time}-${slot.windowEnd} expired (>${WINDOW_EXPIRY_HOURS}h past end). Now=${nowInTz}`,
            stage: "window_expired",
            plugin: null,
          }).catch(() => {});
        } else {
          await this.deps.dailyPlanner.markSlotFired(slot, "window-expired").catch(() => {});
        }
        this.deps.logger.warn("scheduler.skip", {
          slotIndex: slot.index,
          date: slot.date,
          window: `${slot.time}-${slot.windowEnd}`,
          reason: "window_expired",
          nowTime: nowInTz,
          message: `Window ${slot.time}-${slot.windowEnd} expired — marking as failed`,
        });
        await this.notifyAdminOfGraceFailure(slot, now).catch(() => {});
        continue;
      }

      // v11.18.0: scheduledTime reached — fire it!
      this.deps.logger.info("scheduler.slot_fired", {
        slotIndex: slot.index,
        window: `${slot.time}-${slot.windowEnd}`,
        scheduledTime: slot.scheduledTime ?? slot.time,
        nowTime: nowInTz,
        category: slot.category,
        message: `Firing scheduledTime ${slot.scheduledTime ?? slot.time} in window ${slot.time}-${slot.windowEnd} (now: ${nowInTz})`,
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

      // v12.0.0: Use `now` to show the current time when the expiry was detected.
      const nowInTz = new Intl.DateTimeFormat("en-US", {
        timeZone: settings.scheduler.timezone || "UTC",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(now));

      const msg = [
        ``,
        `<b>━━━ ⚠️ WINDOW EXPIRED ━━━</b>`,
        ``,
        `<blockquote>📅 <b>Window:</b> #${slot.index} ${slot.time}-${slot.windowEnd}</blockquote>`,
        `<blockquote>🎯 <b>Scheduled:</b> ${slot.scheduledTime ?? slot.time}</blockquote>`,
        `<blockquote>📂 <b>Category:</b> ${slot.category}</blockquote>`,
        `<blockquote>🕐 <b>Detected at:</b> ${nowInTz} (${settings.scheduler.timezone})</blockquote>`,
        `<blockquote>💡 <b>Cause:</b> Window expired (6h+ past end, cron may have missed multiple ticks)</blockquote>`,
      ].join("\n");

      await this.deps.tg?.sendMessage(adminId, msg, { parse_mode: "HTML" }).catch(() => {});
    } catch {
      // non-fatal — notification is best-effort
    }
  }

  /**
   * v12.0.5: Acquire a content candidate for a slot.
   * Encapsulates: dequeue from same-category queue → processForCategory → fallback plugins.
   * Returns ReadyContent if a valid candidate is found, null otherwise.
   *
   * This method is called multiple times by the replacement loop in fireSlot()
   * when a candidate is rejected as a duplicate. Each call will:
   *   1. Try dequeue (the queue may have been refilled since the last attempt)
   *   2. If queue empty, call processForCategory (fetches fresh items, filters dups)
   *   3. If that fails, try fallback plugins from the same category
   *
   * IMPORTANT: Only returns content from the SAME CATEGORY as the slot.
   * This preserves category distribution — a Cat A slot will never get Cat B content.
   */
  private async acquireContent(
    slot: SlotTime,
    settings: FredySettings,
    expectedLang: string,
  ): Promise<ReadyContent | null> {
    // 1. Try to dequeue ready content for this category.
    for (let attempt = 0; attempt < 5; attempt++) {
      const queued = await this.deps.contentQueue.dequeue(slot.category);
      if (!queued) break;
      const queuedLang = queued.content.language;
      if (queuedLang === expectedLang || queuedLang === settings.language.default) {
        return queued.content;
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
    const pipelineResult = await this.deps.contentManager.processForCategory(
      slot.category,
      null,
      settings.language.default,
      { skipEnqueue: true },
    );

    if (pipelineResult.ok && pipelineResult.content) {
      return pipelineResult.content;
    }

    this.deps.logger.warn("scheduler.skip", {
      slotIndex: slot.index,
      category: slot.category,
      reason: pipelineResult.error ?? "Pipeline failed",
      message: "No content available — trying fallback plugin",
    });

    // 3. Try fallback plugins from the same category.
    const fallbackPlugins = this.getFallbackPlugins(slot.category);
    for (const fbPlugin of fallbackPlugins) {
      try {
        const fbResult = await this.deps.contentManager.processFromPlugin(
          fbPlugin,
          settings.language.default,
          { skipEnqueue: true },
        );
        if (fbResult.ok && fbResult.content) {
          this.deps.logger.info("pipeline.complete", {
            slotIndex: slot.index,
            fallbackPlugin: fbPlugin,
            contentId: fbResult.content.id,
            message: "Fallback plugin succeeded",
          });
          return fbResult.content;
        }
      } catch (e) {
        this.deps.logger.warn("source.fetch_error", {
          fallbackPlugin: fbPlugin,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return null; // No content available from any source.
  }

  /** Fire a slot — acquire content, publish, with v12.0.5 replacement loop.
   *
   *  v12.0.5 REPLACEMENT PIPELINE:
   *  When a candidate is rejected as a duplicate, Fredy now automatically
   *  searches for another valid post from the SAME CATEGORY (up to 5 attempts).
   *  The scheduler slot (window, scheduledTime, category) is PRESERVED —
   *  only the content source changes. This prevents missing posts in the
   *  daily schedule when duplicates are detected.
   *
   *  Flow:
   *    for attempt 1..5:
   *      candidate = acquireContent(slot)   // dequeue → processForCategory → fallbacks
   *      if !candidate → fail (no content)
   *      result = publish(candidate)
   *      if result.ok → success (mark published, notify, return)
   *      if isDedup(result) && attempt < 5 → log replacement, continue
   *      else → break (non-dedup failure → try backup plugin)
   *    // All attempts failed
   *    if all were dedup → fail with NO_VALID_CONTENT_AFTER_DEDUP
   *    else → existing failure handling (v8.8.0 backup, mark failed, notify)
   */
  private async fireSlot(slot: SlotTime): Promise<PublishResult> {
    this.deps.logger.info("scheduler.slot_fired", {
      slotIndex: slot.index,
      date: slot.date,
      time: slot.time,
      scheduledTime: slot.scheduledTime ?? slot.time,
      category: slot.category,
      message: "Firing slot",
    });

    const settings = await this.deps.settings();
    const expectedLang = (settings.language.default === "fa" || settings.language.default === "en")
      ? settings.language.default
      : (settings.language.autoDetect ? "fa" : "en");

    // v12.0.5: Replacement tracking for logging + dashboard.
    const replacements: Array<{
      attempt: number;
      contentId: string;
      pluginId: string;
      reason: string;
    }> = [];

    // v12.0.5: Write "publishing" marker BEFORE the replacement loop.
    // This prevents duplicate processing if the Worker crashes mid-loop.
    if (this.deps.strategyEngine) {
      await this.deps.strategyEngine.markPostPublishing(slot.date, slot.index).catch(() => {});
    }

    // ════════════════════════════════════════════════════════════
    // v12.0.5: REPLACEMENT LOOP — try up to 5 candidates on dedup.
    // ════════════════════════════════════════════════════════════
    let lastContent: ReadyContent | null = null;
    let lastResult: PublishResult | null = null;
    let noContentAtAll = false;

    for (let attempt = 1; attempt <= SchedulerService.MAX_REPLACEMENT_ATTEMPTS; attempt++) {
      // ── Acquire candidate (same-category only) ──
      const content = await this.acquireContent(slot, settings, expectedLang);

      if (!content) {
        // No content available from any source.
        noContentAtAll = (attempt === 1);
        this.deps.logger.warn("scheduler.skip", {
          slotIndex: slot.index,
          attempt: `${attempt}/${SchedulerService.MAX_REPLACEMENT_ATTEMPTS}`,
          message: "No content available for replacement",
        });
        break;
      }

      lastContent = content;

      // ── Publish ──
      let result: PublishResult;
      try {
        result = await this.deps.publishingService.publish(content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          ok: false,
          contentId: content.id,
          category: slot.category,
          telegramMessageId: null,
          telegramChatId: null,
          publishedAt: Date.now(),
          error: message,
          attempts: attempt - 1,
        };
      }

      lastResult = result;

      // ── Success? ──
      if (result.ok) {
        // v12.0.5: Log replacement summary if any attempts failed.
        if (attempt > 1) {
          this.deps.logger.info("pipeline.replacement_success", {
            PUBLISH_PIPELINE: true,
            slot: `${slot.date} ${slot.scheduledTime ?? slot.time}`,
            category: slot.category,
            originalCandidate: replacements[0]?.contentId ?? "n/a",
            replacementAttempts: attempt - 1,
            finalPublished: content.id,
            finalPlugin: content.pluginId,
            message: `Published after ${attempt - 1} replacement(s)`,
          });
        }

        // Mark slot as fired (non-strategy path).
        if (!this.deps.strategyEngine) {
          await this.deps.dailyPlanner.markSlotFired(slot, content.id);
        }

        // v8.2.1: Update strategy plan status.
        if (this.deps.strategyEngine) {
          await this.deps.strategyEngine.markPostPublished(slot.date, slot.index).catch((e: unknown) => {
            this.deps.logger.warn("scheduler.skip", {
              slotIndex: slot.index,
              error: e instanceof Error ? e.message : String(e),
              message: "markPostPublished failed",
            });
          });
          // v9.3.1: Record in dedup store ONLY after successful publish.
          if (this.deps.duplicateDetector) {
            await this.deps.duplicateDetector.recordPublished(content).catch(() => {});
          }
        }

        // Reset failure counter.
        this.consecutiveFailures = 0;

        // Notify admin PM.
        await this.notifyAdminPm(content, result, slot).catch((err) => {
          this.deps.logger.warn("scheduler.admin_pm_failed", {
            contentId: content.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // v12.0.5: If replacements happened, record them in the failure ring buffer
        // (for dashboard visibility — shows what was tried before success).
        if (replacements.length > 0) {
          for (const rep of replacements) {
            await this.recordFailure({
              slot,
              error: `Duplicate (replaced) — ${rep.reason}`,
              stage: "duplicate_replaced",
              plugin: rep.pluginId,
              contentId: rep.contentId,
            }).catch(() => {});
          }
        }

        return result;
      }

      // ── Check if dedup failure ──
      if (this.isDedupFailure(result)) {
        replacements.push({
          attempt,
          contentId: content.id,
          pluginId: content.pluginId,
          reason: result.error ?? "duplicate",
        });

        this.deps.logger.info("pipeline.replacement", {
          PUBLISH_PIPELINE: true,
          slot: `${slot.date} ${slot.scheduledTime ?? slot.time}`,
          category: slot.category,
          candidate: content.id,
          candidatePlugin: content.pluginId,
          DEDUP_RESULT: "duplicate",
          reason: result.error,
          ACTION: "searching replacement",
          attempt: `${attempt}/${SchedulerService.MAX_REPLACEMENT_ATTEMPTS}`,
          message: `Duplicate detected — searching replacement (attempt ${attempt}/${SchedulerService.MAX_REPLACEMENT_ATTEMPTS})`,
        });

        if (attempt < SchedulerService.MAX_REPLACEMENT_ATTEMPTS) {
          continue; // ── Try next candidate ──
        }
        // Last attempt was also a dup — fall through to failure handling.
        break;
      }

      // ── Non-dedup failure — break to existing failure handling ──
      break;
    }

    // ════════════════════════════════════════════════════════════
    // FAILURE HANDLING (all attempts failed, or no content, or non-dedup error)
    // ════════════════════════════════════════════════════════════

    // Case 1: No content available at all (acquireContent returned null on first attempt).
    if (noContentAtAll) {
      const failError = "No content available (all plugins returned empty or failed pipeline)";
      await this.notifyAdminOfFailure(slot, failError, null, { stage: "pipeline", plugin: null }).catch(() => {});

      if (this.deps.strategyEngine) {
        await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
          error: failError,
          stage: "pipeline",
          plugin: null,
        }).catch(() => {});
      } else {
        await this.deps.dailyPlanner.markSlotFired(slot, "no-content");
      }

      await this.recordFailure({
        slot,
        error: failError,
        stage: "pipeline",
        plugin: null,
        contentId: null,
      }).catch(() => {});

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

    // Case 2: All candidates were duplicates.
    if (lastResult && this.isDedupFailure(lastResult) && replacements.length > 0) {
      const failError = `NO_VALID_CONTENT_AFTER_DEDUP (${replacements.length} candidates rejected as duplicates)`;
      this.deps.logger.warn("pipeline.replacement_exhausted", {
        PUBLISH_PIPELINE: true,
        slot: `${slot.date} ${slot.scheduledTime ?? slot.time}`,
        category: slot.category,
        totalAttempts: replacements.length,
        rejectedCandidates: replacements.map(r => ({ id: r.contentId, plugin: r.pluginId, reason: r.reason })),
        message: failError,
      });

      if (this.deps.strategyEngine) {
        await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
          error: failError,
          stage: "no_valid_content_after_dedup",
          plugin: replacements[replacements.length - 1]?.pluginId ?? null,
        }).catch(() => {});
      } else {
        await this.deps.dailyPlanner.markSlotFired(slot, "dedup-exhausted");
      }

      // Record all replacement attempts in the failure ring buffer.
      for (const rep of replacements) {
        await this.recordFailure({
          slot,
          error: `Duplicate (exhausted) — ${rep.reason}`,
          stage: "duplicate_exhausted",
          plugin: rep.pluginId,
          contentId: rep.contentId,
        }).catch(() => {});
      }

      // Notify admin with replacement summary.
      const adminId = this.deps.adminId?.() ?? 0;
      if (adminId > 0 && this.deps.tg) {
        const repList = replacements.map(r =>
          `<blockquote>  ${r.attempt}. <code>${escapeHtml(r.contentId)}</code> (${escapeHtml(r.pluginId)}) — ${escapeHtml(r.reason)}</blockquote>`,
        ).join("\n");
        await this.deps.tg.sendMessage(adminId, [
          ``,
          `<b>━━━ ❌ NO VALID CONTENT AFTER DEDUP ━━━</b>`,
          ``,
          ``,
          `<blockquote>📅 <b>Slot:</b> ${slot.date} at ${slot.scheduledTime ?? slot.time} (window ${slot.time}-${slot.windowEnd ?? slot.time})</blockquote>`,
          `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
          `<blockquote>🔍 <b>Attempts:</b> ${replacements.length}/${SchedulerService.MAX_REPLACEMENT_ATTEMPTS}</blockquote>`,
          ``,
          `<b>Rejected candidates:</b>`,
          repList,
          ``,
          `<blockquote>💡 <b>All candidates were duplicates. The slot is marked as failed. Provider caches will refresh on the next 2h Layer 2 tick.</b></blockquote>`,
        ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
      }

      return {
        ok: false,
        contentId: lastContent?.id ?? null,
        category: slot.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: failError,
        attempts: replacements.length,
      };
    }

    // Case 3: Non-dedup publish failure — try v8.8.0 backup plugin.
    if (lastContent && lastResult && !lastResult.ok) {
      this.deps.logger.warn("scheduler.skip", {
        slotIndex: slot.index,
        contentId: lastContent.id,
        error: lastResult.error,
        message: "Publish failed (non-dedup) — trying backup plugin",
      });

      const fallbackPlugins = this.getFallbackPlugins(slot.category);
      for (const fbPlugin of fallbackPlugins) {
        try {
          const fbResult = await this.deps.contentManager.processFromPlugin(
            fbPlugin,
            settings.language.default,
            { skipEnqueue: true },
          );
          if (fbResult.ok && fbResult.content) {
            const fbPubResult = await this.deps.publishingService.publish(fbResult.content);
            if (fbPubResult.ok) {
              // v8.8.0: Backup succeeded.
              if (this.deps.strategyEngine) {
                await this.deps.strategyEngine.markPostBackup(slot.date, slot.index, {
                  error: lastResult.error ?? "unknown",
                  stage: "publish",
                  plugin: lastContent.pluginId,
                }).catch(() => {});
              }
              await this.recordFailure({
                slot,
                error: lastResult.error ?? "unknown",
                stage: "publish",
                plugin: lastContent.pluginId,
                contentId: lastContent.id,
              }).catch(() => {});
              if (this.deps.duplicateDetector) {
                await this.deps.duplicateDetector.recordPublished(fbResult.content).catch(() => {});
              }

              // v12.0.7: Send the EXACT backup post to admin PM (same as channel), then the report.
              const adminId = this.deps.adminId?.() ?? 0;
              if (adminId > 0 && this.deps.tg) {
                // Send the exact same post that went to the channel.
                if (fbPubResult.sentText) {
                  if (fbPubResult.sentMediaUrl) {
                    await this.deps.tg.sendPhoto(adminId, fbPubResult.sentMediaUrl, fbPubResult.sentText, {
                      parse_mode: "HTML",
                    }).catch(() => {});
                  } else {
                    await this.deps.tg.sendMessage(adminId, fbPubResult.sentText, {
                      parse_mode: "HTML",
                    }).catch(() => {});
                  }
                }
                // Then send the backup summary report.
                await this.deps.tg.sendMessage(adminId, [
                  ``,
                  reportBanner("🔄", "BACKUP POST PUBLISHED"),
                  ``,
                  ``,
                  reportRow("📅", "Slot", `${slot.date} at ${slot.scheduledTime ?? slot.time} (window ${slot.time}-${slot.windowEnd ?? slot.time})`),
                  reportRow("🏷️", "Category", slot.category),
                  reportRow("❌", "Original failed", lastResult.error ?? "unknown"),
                  reportRow("🔌", "Original plugin", lastContent.pluginId),
                  reportRow("✅", "Backup plugin", fbPlugin),
                  reportRow("📰", "Backup headline", escapeHtml(fbResult.content.headline ?? "(none)")),
                  qualityRow(fbResult.content.quality.overallScore),
                  reportRow("📤", "Channel Msg ID", String(fbPubResult.telegramMessageId)),
                  reportRow("🔖", "Content ID", fbResult.content.id),
                ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
              }

              if (!this.deps.strategyEngine) {
                await this.deps.dailyPlanner.markSlotFired(slot, fbResult.content.id);
              }
              this.consecutiveFailures = 0;
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
      const finalError = lastResult.error ?? "All plugins failed (primary + fallbacks)";
      if (this.deps.strategyEngine) {
        await this.deps.strategyEngine.markPostFailed(slot.date, slot.index, {
          error: finalError,
          stage: "publish",
          plugin: lastContent.pluginId,
        }).catch((e: unknown) => {
          this.deps.logger.warn("scheduler.skip", {
            slotIndex: slot.index,
            error: e instanceof Error ? e.message : String(e),
            message: "markPostFailed failed",
          });
        });
      }

      await this.recordFailure({
        slot,
        error: finalError,
        stage: "publish",
        plugin: lastContent.pluginId,
        contentId: lastContent.id,
      }).catch(() => {});

      // Send failure report to admin.
      const adminId = this.deps.adminId?.() ?? 0;
      if (adminId > 0 && this.deps.tg) {
        await this.deps.tg.sendMessage(adminId, [
          ``,
          `<b>━━━ ❌ POST FAILED ━━━</b>`,
          ``,
          ``,
          `<blockquote>📅 <b>Slot:</b> ${slot.date} at ${slot.scheduledTime ?? slot.time}</blockquote>`,
          `<blockquote>🏷️ <b>Category:</b> ${slot.category}</blockquote>`,
          `<blockquote>🔌 <b>Original plugin:</b> ${escapeHtml(lastContent.pluginId)}</blockquote>`,
          `<blockquote>🔖 <b>Content ID:</b> <code>${escapeHtml(lastContent.id)}</code></blockquote>`,
          `<blockquote>❌ <b>Error:</b> ${escapeHtml(finalError)}</blockquote>`,
          `<blockquote>⚠️ <b>All fallback plugins also failed.</b></blockquote>`,
        ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
      }

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        const adminId2 = this.deps.adminId?.() ?? 0;
        if (adminId2 > 0 && this.deps.tg) {
          await this.deps.tg.sendMessage(adminId2, [
            `⚠️ <b>Scheduler: 3 consecutive failures</b>`,
            ``,
            `<b>Last error:</b> ${escapeHtml(finalError)}`,
            `<b>Slot:</b> ${slot.date} ${slot.time} (cat ${slot.category})`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
        this.consecutiveFailures = 0;
      }

      // Notify admin PM with the formatted post.
      await this.notifyAdminPm(lastContent, lastResult, slot).catch(() => {});

      return lastResult;
    }

    // Fallback: should not reach here, but return a failure if we do.
    return {
      ok: false,
      contentId: lastContent?.id ?? null,
      category: slot.category,
      telegramMessageId: null,
      telegramChatId: null,
      publishedAt: Date.now(),
      error: lastResult?.error ?? "Unknown publish failure",
      attempts: replacements.length,
    };
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
    if (adminId <= 0 || !this.deps.tg) return;

    // v12.0.7: Send the EXACT same post that went to the channel — using the
    // sentText + sentMediaUrl from PublishResult (captured inside FinalPublisher).
    // This ensures the admin PM receives an identical copy, not a re-transformed
    // version that might differ slightly.
    if (pubResult.ok && pubResult.sentText) {
      const mediaUrl = pubResult.sentMediaUrl;
      if (mediaUrl) {
        // Photo post — send the same photo + caption to admin PM.
        await this.deps.tg.sendPhoto(adminId, mediaUrl, pubResult.sentText, {
          parse_mode: "HTML",
        }).catch(() => {});
      } else {
        // Text-only post — send the same text to admin PM.
        await this.deps.tg.sendMessage(adminId, pubResult.sentText, {
          parse_mode: "HTML",
        }).catch(() => {});
      }
    }

    // Then send the summary report.
    const statusBanner = pubResult.ok
      ? reportBanner("✅", "AUTO-PUBLISHED")
      : reportBanner("❌", "AUTO-PUBLISH FAILED");

    await this.deps.tg.sendMessage(adminId, [
      statusBanner,
      ``,
      reportRow("📅", "Scheduled", `${slot.date} at ${slot.scheduledTime ?? slot.time} (window ${slot.time}-${slot.windowEnd ?? slot.time})`),
      reportRow("🏷️", "Category", slot.category),
      reportRow("🔌", "Source Plugin", content.pluginId),
      reportRow("📰", "Headline", escapeHtml(content.headline ?? "(none)")),
      reportRow("🔗", "Source URL", escapeHtml(content.sourceUrl ?? "(none)")),
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
            windowEnd: p.windowEnd ?? p.time,
            scheduledTime: p.scheduledTime,  // v11.17.0: display-only
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
      // v11.16.0: Window-based next slot — find next PENDING window
      // whose start time hasn't been reached yet.
      if (this.deps.strategyEngine) {
        try {
          const stratPlan = await this.deps.strategyEngine.getOrGeneratePlan();
          const tz = (await this.deps.settings()).scheduler.timezone || "UTC";
          const nowInTz = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
          }).format(new Date());
          const [nowH, nowM] = nowInTz.split(":").map(Number);
          const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

          // v11.18.0: Find next pending post whose scheduledTime is in the future.
          const nextPost = stratPlan.posts.find((p) => {
            if (p.status !== "pending") return false;
            const schedTime = p.scheduledTime ?? p.time;
            const [sH, sM] = schedTime.split(":").map(Number);
            const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
            return nowMinutes < schedMin;
          });
          if (nextPost) {
            nextSlot = {
              index: nextPost.index,
              date: nextPost.date,
              time: nextPost.time,
              windowEnd: nextPost.windowEnd ?? nextPost.time,
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

/**
 * src/services/strategy-engine.ts
 * Strategy Engine — the brain of Fredy's content planning system.
 *
 * Responsibilities:
 *   - Select active publishing strategy
 *   - Calculate daily content distribution
 *   - Assign categories to posting windows
 *   - Generate DailyPublishPlan
 *   - Respect quiet hours, posting windows, weekly themes
 *   - Validate the plan before saving
 *
 * The engine NEVER publishes posts. It only produces a plan that the
 * Scheduler consumes.
 */

import type {
  StrategyMode,
  StrategyDefinition,
  DailyTheme,
  PlannedPost,
  PlannedPostStatus,
  DailyPublishPlan,
  PostPriority,
  PlanValidationResult,
} from "../types/strategy";
import type { Category } from "../types/category";
import type { SchedulerConfig } from "../core/config/sections/scheduler";
import type { StrategyConfig } from "../core/config/sections/strategy";
import {
  BUILTIN_STRATEGIES,
  DEFAULT_WEEKLY_THEMES,
  CATEGORY_PROVIDERS,
} from "../core/config/sections/strategy";
import type { TimeGenerator } from "./time-generator";
import type { QuietHoursChecker } from "./quiet-hours-checker";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";
import { formatDateInZone } from "../primitives/time";
import { randomInt } from "../primitives/random";

export interface StrategyEngineDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly timeGenerator: TimeGenerator;
  readonly quietHoursChecker: QuietHoursChecker;
  readonly schedulerConfig: () => Promise<SchedulerConfig>;
  readonly strategyConfig: () => Promise<StrategyConfig>;
  /** v11.7.1: Used to filter out disabled providers during plan generation. */
  readonly pluginManager: import("./plugin-manager").PluginManager;
}

/** KV key for storing the daily publish plan. */
const PLAN_KEY = (date: string) => `fredy:strategy:plan:${date}`;
const PLAN_TTL_SECONDS = 48 * 3600; // 48 hours

export class StrategyEngine {
  /** v12.0.9: In-memory plan cache to fix the "plan refresh" bug.
   *  Cloudflare KV is eventually consistent — after generatePlan() writes
   *  a new plan, getOrGeneratePlan() might still read the OLD plan from
   *  the KV edge cache for up to 60 seconds. This in-memory cache ensures
   *  the freshly-generated plan is returned immediately. */
  private cachedPlan: DailyPublishPlan | null = null;

  constructor(private readonly deps: StrategyEngineDeps) {}

  // ────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────

  /** Get the active strategy definition. */
  getActiveStrategy(strategyConfig: StrategyConfig): StrategyDefinition {
    const mode = strategyConfig.mode;
    if (mode === "custom") {
      const dist = strategyConfig.customDistribution;
      const total = dist.A + dist.B + dist.C;
      return {
        mode: "custom",
        name: "Custom",
        description: "Administrator-defined distribution",
        distribution: { ...dist, total },
      };
    }
    return BUILTIN_STRATEGIES[mode] ?? BUILTIN_STRATEGIES.balanced!;
  }

  /** Get the weekly theme for a given date. */
  getThemeForDate(date: string, enabled: boolean): DailyTheme | null {
    if (!enabled) return null;
    try {
      const d = new Date(date + "T00:00:00Z");
      const dayOfWeek = d.getUTCDay();
      return DEFAULT_WEEKLY_THEMES.find((t) => t.day === dayOfWeek) ?? null;
    } catch { /* non-fatal */
      return null;
    }
  }

  /**
   * Generate a complete DailyPublishPlan for the given date.
   *
   * Steps:
   *   1. Load strategy + scheduler config
   *   2. Get distribution from strategy
   *   3. Get weekly theme
   *   4. Generate slot times via TimeGenerator
   *   5. Assign categories + providers + priorities to slots
   *   6. Validate the plan
   *   7. Save to KV
   */
  async generatePlan(date?: string): Promise<DailyPublishPlan> {
    const startTime = Date.now();
    const schedulerConfig = await this.deps.schedulerConfig();
    const strategyConfig = await this.deps.strategyConfig();

    const targetDate = date ?? formatDateInZone(Date.now(), schedulerConfig.timezone);

    // 1. Get strategy definition.
    const strategy = this.getActiveStrategy(strategyConfig);

    // 2. Get distribution.
    const distribution = strategy.distribution;

    // 3. Get weekly theme.
    const theme = this.getThemeForDate(targetDate, strategyConfig.weeklyThemesEnabled);

    // 4. Generate slot times.
    const categoryDist: Record<Category, number> = {
      A: distribution.A,
      B: distribution.B,
      C: distribution.C,
    };
    const slots = this.deps.timeGenerator.generate(
      targetDate,
      schedulerConfig,
      categoryDist,
    );

    // 5. Assign categories + providers + priorities.
    // v9.3.2: Do NOT mark past slots as "failed" on generation — let the
    // scheduler's findDueSlot() handle them with the grace period. Marking
    // them as "failed" here prevented the scheduler from ever firing them,
    // causing all past slots to be silently skipped when a plan was
    // regenerated mid-day.
    const posts: PlannedPost[] = slots.map((slot, index) => {
      const provider = this.selectProvider(slot.category, theme);
      const priority = this.assignPriority(slot.category, strategy.mode);
      return {
        id: `plan-${targetDate}-${index}`,
        index,
        date: targetDate,
        time: slot.time,
        windowEnd: slot.windowEnd ?? slot.time,
        scheduledTime: slot.scheduledTime,  // v11.17.0: display-only random time
        epochMs: slot.epochMs,
        category: slot.category,
        provider,
        strategy: strategy.mode,
        language: strategyConfig.language === "auto" ? "fa" : strategyConfig.language,
        priority,
        queueTarget: this.getQueueTarget(slot.category),
        status: "pending" as PlannedPostStatus,
        windowIndex: index,
      };
    });

    // 6. Validate.
    const validation = this.validatePlan(posts, schedulerConfig);

    // 7. Build plan.
    const plan: DailyPublishPlan = {
      date: targetDate,
      strategy: strategy.mode,
      theme,
      posts,
      generatedAt: Date.now(),
      timezone: schedulerConfig.timezone,
      language: strategyConfig.language === "auto" ? "fa" : strategyConfig.language,
      distribution,
      validation,
    };

    // 8. Save to KV.
    await this.deps.kv.setJson(PLAN_KEY(targetDate), plan, PLAN_TTL_SECONDS).catch(() => {});

    // v12.0.9: Cache in memory so getOrGeneratePlan() returns the FRESH plan
    // immediately (bypasses KV eventual consistency).
    this.cachedPlan = plan;

    const durationMs = Date.now() - startTime;
    this.deps.logger.info("pipeline.start", {
      step: "strategy.generatePlan",
      date: targetDate,
      strategy: strategy.mode,
      theme: theme?.dayName ?? "none",
      postCount: posts.length,
      distribution,
      valid: validation.valid,
      durationMs,
      message: "Daily publish plan generated",
    });

    return plan;
  }

  /** Load today's plan from KV (or generate if missing).
   *  v12.0.9: Check in-memory cache FIRST (bypasses KV eventual consistency
   *  after a regenerate). Falls back to KV, then generates if missing.
   *  v11.2.0: Added defensive date check. */
  async getOrGeneratePlan(date?: string): Promise<DailyPublishPlan> {
    const schedulerConfig = await this.deps.schedulerConfig();
    const targetDate = date ?? formatDateInZone(Date.now(), schedulerConfig.timezone);

    // v12.0.9: Check in-memory cache first — avoids stale KV reads after regenerate.
    if (this.cachedPlan && this.cachedPlan.date === targetDate) {
      return this.cachedPlan;
    }

    const existing = await this.deps.kv.getJson<DailyPublishPlan>(PLAN_KEY(targetDate));
    // v11.2.0: Defensive date check — protects against clock skew / KV corruption.
    if (existing && existing.date === targetDate) {
      // v12.0.9: Cache the KV-loaded plan in memory for subsequent calls.
      this.cachedPlan = existing;
      return existing;
    }

    return this.generatePlan(targetDate);
  }

  /**
   * v11.2.0: Mark a planned post as "publishing" BEFORE the actual publish call.
   *
   * This prevents duplicate posts when the Worker crashes between publish()
   * returning and markPostPublished() writing. The next tick sees "publishing"
   * status and skips the slot (treating it as already in progress).
   *
   * If a slot stays "publishing" for too long (crash mid-publish), the admin
   * can manually reset it from the dashboard.
   */
  async markPostPublishing(date: string, postIndex: number): Promise<void> {
    const plan = await this.getOrGeneratePlan(date);
    const updatedPosts = plan.posts.map((p) =>
      p.index === postIndex
        ? { ...p, status: "publishing" as PlannedPostStatus, failedAt: Date.now() }
        : p,
    );
    const updatedPlan = { ...plan, posts: updatedPosts };
    await this.savePlan(date, updatedPlan);
  }

  /** v12.0.9: Save plan to KV + update in-memory cache (fixes stale-read bug). */
  private async savePlan(date: string, plan: DailyPublishPlan): Promise<void> {
    await this.deps.kv.setJson(PLAN_KEY(date), plan, PLAN_TTL_SECONDS).catch((e) => {
      this.deps.logger.warn("pipeline.error", { error: String(e), message: "savePlan setJson failed" });
    });
    // Update in-memory cache so subsequent getOrGeneratePlan() calls see the update.
    this.cachedPlan = plan;
  }

  /** Mark a planned post as published.
   *  v8.5.0: Also mark the corresponding daily-planner slot as fired,
   *  so the two plans stay in sync. */
  async markPostPublished(date: string, postIndex: number): Promise<void> {
    const plan = await this.getOrGeneratePlan(date);
    const updatedPosts = plan.posts.map((p) =>
      p.index === postIndex ? { ...p, status: "published" as PlannedPostStatus } : p,
    );
    const updatedPlan = { ...plan, posts: updatedPosts };
    await this.savePlan(date, updatedPlan);
  }

  /** Mark a planned post as failed.
   *  v9.2.3: Now accepts an optional `errorInfo` object that captures the
   *  failure reason, pipeline stage, and plugin attempted. This is surfaced
   *  by the Manager UI when the admin clicks the ❌ Failed badge, and is
   *  always sent to the admin PM. Backward compatible — callers without
   *  the parameter still work (error info stays null). */
  async markPostFailed(
    date: string,
    postIndex: number,
    errorInfo?: { error?: string; stage?: string; plugin?: string | null } | null,
  ): Promise<void> {
    const plan = await this.getOrGeneratePlan(date);
    const updatedPosts = plan.posts.map((p) =>
      p.index === postIndex
        ? {
            ...p,
            status: "failed" as PlannedPostStatus,
            error: errorInfo?.error ?? p.error ?? null,
            failedStage: errorInfo?.stage ?? p.failedStage ?? null,
            failedPlugin: errorInfo?.plugin ?? p.failedPlugin ?? null,
            failedAt: Date.now(),
          }
        : p,
    );
    const updatedPlan = { ...plan, posts: updatedPosts };
    await this.savePlan(date, updatedPlan);
  }

  /** v8.8.0: Mark a planned post as backup (original failed, backup succeeded).
   *  v9.2.3: Now accepts the original failure reason so the admin can see
   *  WHY the primary plugin failed even though the backup saved the slot. */
  async markPostBackup(
    date: string,
    postIndex: number,
    errorInfo?: { error?: string; stage?: string; plugin?: string | null } | null,
  ): Promise<void> {
    const plan = await this.getOrGeneratePlan(date);
    const updatedPosts = plan.posts.map((p) =>
      p.index === postIndex
        ? {
            ...p,
            status: "backup" as PlannedPostStatus,
            error: errorInfo?.error ?? p.error ?? null,
            failedStage: errorInfo?.stage ?? p.failedStage ?? null,
            failedPlugin: errorInfo?.plugin ?? p.failedPlugin ?? null,
            failedAt: Date.now(),
          }
        : p,
    );
    const updatedPlan = { ...plan, posts: updatedPosts };
    await this.savePlan(date, updatedPlan);
  }

  // ────────────────────────────────────────────────────────
  // Internal: Provider Selection
  // ────────────────────────────────────────────────────────

  /**
   * Select a provider for a category, influenced by the weekly theme.
   * If the theme has topics that match a provider's keywords, that
   * provider is preferred. Otherwise, a random provider is selected.
   *
   * v11.7.1: CRITICAL FIX — filters out DISABLED providers. Previously, the
   * strategy engine could assign "news" (legacy, disabled) or "wikimedia"
   * (legacy, disabled) to slots, causing the scheduler to fail when trying
   * to fetch from a disabled provider.
   */
  private selectProvider(category: Category, theme: DailyTheme | null): string | null {
    const allProviders = CATEGORY_PROVIDERS[category];
    if (!allProviders || allProviders.length === 0) return null;

    // v11.7.1: Filter to only ENABLED providers.
    const providers = allProviders.filter((id) => this.deps.pluginManager.isEnabled(id));
    if (providers.length === 0) return null;

    // If no theme, pick random.
    if (!theme || theme.topics.length === 0) {
      return providers[randomInt(0, providers.length - 1)]!;
    }

    // Check if any provider name matches a theme topic.
    const themeTopicsLower = theme.topics.map((t) => t.toLowerCase());
    for (const provider of providers) {
      const providerLower = provider.toLowerCase();
      if (themeTopicsLower.some((topic) => providerLower.includes(topic) || topic.includes(providerLower))) {
        return provider;
      }
    }

    // No match — pick random.
    return providers[randomInt(0, providers.length - 1)]!;
  }

  // ────────────────────────────────────────────────────────
  // Internal: Priority Assignment
  // ────────────────────────────────────────────────────────

  /**
   * Assign a priority level based on category and strategy.
   *
   * - Category A: always "high" (core developer content is the priority)
   * - Category B: "high" for news_priority strategy, "normal" otherwise
   * - Category C: always "low" (support content)
   */
  private assignPriority(category: Category, strategyMode: StrategyMode): PostPriority {
    if (category === "A") return "high";
    if (category === "B") {
      return strategyMode === "news_priority" ? "high" : "normal";
    }
    return "low"; // category C
  }

  // ────────────────────────────────────────────────────────
  // Internal: Queue Target
  // ────────────────────────────────────────────────────────

  /** Get the queue target depth for a category. */
  private getQueueTarget(category: Category): number {
    switch (category) {
      case "A": return 4;
      case "B": return 2;
      case "C": return 2;
      default: return 2;
    }
  }

  /** v11.16.0: Convert date + HH:MM + timezone to epoch ms (for quiet hours check). */
  private timeStringToEpoch(date: string, hhmm: string, timezone: string): number {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, min] = hhmm.split(":").map(Number);
    const utcMidnight = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
    // Use Intl to get timezone offset.
    try {
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
      const parts = dtf.formatToParts(new Date(utcMidnight));
      const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? "0");
      const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour"), get("minute"), get("second"));
      const offsetMin = Math.round((asIfUtc - utcMidnight) / 60_000);
      return utcMidnight + ((hour ?? 0) * 60 + (min ?? 0) - offsetMin) * 60_000;
    } catch {
      return utcMidnight + ((hour ?? 0) * 60 + (min ?? 0)) * 60_000;
    }
  }

  // ────────────────────────────────────────────────────────
  // Internal: Validation
  // ────────────────────────────────────────────────────────

  /**
   * Validate the generated plan.
   *
   * Rules:
   *   - No duplicate providers consecutively
   *   - No duplicate categories more than twice in a row
   *   - Respect quiet hours (no posts during quiet hours)
   *   - Respect minimum gap
   *   - Ensure at least one post
   */
  private validatePlan(posts: readonly PlannedPost[], config: SchedulerConfig): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (posts.length === 0) {
      errors.push("Plan has no posts");
      return { valid: false, errors, warnings };
    }

    // Check consecutive duplicate providers.
    for (let i = 1; i < posts.length; i++) {
      const prev = posts[i - 1]!;
      const curr = posts[i]!;
      if (curr.provider && curr.provider === prev.provider) {
        warnings.push(`Duplicate provider "${curr.provider}" at posts ${prev.index} and ${curr.index}`);
      }
    }

    // Check consecutive duplicate categories (more than twice in a row).
    let consecutiveCount = 1;
    for (let i = 1; i < posts.length; i++) {
      const prev = posts[i - 1]!;
      const curr = posts[i]!;
      if (curr.category === prev.category) {
        consecutiveCount++;
        if (consecutiveCount > 2) {
          warnings.push(`Category "${curr.category}" appears ${consecutiveCount} times in a row (posts ${i - consecutiveCount + 1}-${i})`);
        }
      } else {
        consecutiveCount = 1;
      }
    }

    // v11.16.0: Check quiet hours using window START time (not epochMs).
    const qh = config.quietHours;
    if (qh) {
      for (const post of posts) {
        // Use the window start time string for quiet hours check.
        const isQuiet = this.deps.quietHoursChecker.isQuietHours(
          this.timeStringToEpoch(post.date, post.time, config.timezone),
          config,
        );
        if (isQuiet) {
          warnings.push(`Window ${post.index} (${post.time}-${post.windowEnd ?? post.time}) falls inside quiet hours (${qh.start}–${qh.end})`);
        }
      }
    }

    // v11.16.0: Check minimum gap between windows using time strings.
    for (let i = 1; i < posts.length; i++) {
      const prevEnd = posts[i - 1]!.windowEnd ?? posts[i - 1]!.time;
      const currStart = posts[i]!.time;
      const [pH, pM] = prevEnd.split(":").map(Number);
      const [cH, cM] = currStart.split(":").map(Number);
      const prevEndMin = (pH ?? 0) * 60 + (pM ?? 0);
      const currStartMin = (cH ?? 0) * 60 + (cM ?? 0);
      const gapMin = currStartMin - prevEndMin;
      if (gapMin < config.minGapMinutes) {
        warnings.push(`Gap between windows ${posts[i - 1]!.index} and ${posts[i]!.index} is ${gapMin} min (min: ${config.minGapMinutes})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

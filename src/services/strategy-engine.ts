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
}

/** KV key for storing the daily publish plan. */
const PLAN_KEY = (date: string) => `fredy:strategy:plan:${date}`;
const PLAN_TTL_SECONDS = 48 * 3600; // 48 hours

export class StrategyEngine {
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

  /** Load today's plan from KV (or generate if missing). */
  async getOrGeneratePlan(date?: string): Promise<DailyPublishPlan> {
    const schedulerConfig = await this.deps.schedulerConfig();
    const targetDate = date ?? formatDateInZone(Date.now(), schedulerConfig.timezone);

    const existing = await this.deps.kv.getJson<DailyPublishPlan>(PLAN_KEY(targetDate));
    if (existing) return existing;

    return this.generatePlan(targetDate);
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
    await this.deps.kv.setJson(PLAN_KEY(date), updatedPlan, PLAN_TTL_SECONDS).catch((e) => {
      this.deps.logger.warn("pipeline.error", { error: String(e), message: "markPostPublished setJson failed" });
    });
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
    await this.deps.kv.setJson(PLAN_KEY(date), updatedPlan, PLAN_TTL_SECONDS).catch((e) => {
      this.deps.logger.warn("pipeline.error", { error: String(e), message: "markPostFailed setJson failed" });
    });
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
    await this.deps.kv.setJson(PLAN_KEY(date), updatedPlan, PLAN_TTL_SECONDS).catch((e) => {
      this.deps.logger.warn("pipeline.error", { error: String(e), message: "markPostBackup setJson failed" });
    });
  }

  // ────────────────────────────────────────────────────────
  // Internal: Provider Selection
  // ────────────────────────────────────────────────────────

  /**
   * Select a provider for a category, influenced by the weekly theme.
   * If the theme has topics that match a provider's keywords, that
   * provider is preferred. Otherwise, a random provider is selected.
   */
  private selectProvider(category: Category, theme: DailyTheme | null): string | null {
    const providers = CATEGORY_PROVIDERS[category];
    if (!providers || providers.length === 0) return null;

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

    // Check quiet hours — posts should not be inside quiet hours.
    const qh = config.quietHours;
    if (qh) {
      for (const post of posts) {
        const isQuiet = this.deps.quietHoursChecker.isQuietHours(post.epochMs, config);
        if (isQuiet) {
          warnings.push(`Post ${post.index} (${post.time}) falls inside quiet hours (${qh.start}–${qh.end})`);
        }
      }
    }

    // Check minimum gap between posts.
    for (let i = 1; i < posts.length; i++) {
      const gapMs = posts[i]!.epochMs - posts[i - 1]!.epochMs;
      const gapMin = gapMs / (60 * 1000);
      if (gapMin < config.minGapMinutes) {
        warnings.push(`Gap between posts ${posts[i - 1]!.index} and ${posts[i]!.index} is ${gapMin.toFixed(0)} min (min: ${config.minGapMinutes})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

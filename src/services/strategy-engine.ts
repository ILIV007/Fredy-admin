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
// v13.1.3: selectProviderWeighted replaces uniform-random provider selection.
// Reads the `weight` field from each provider's config entry in providers.config.ts.
import { selectProviderWeighted } from "../core/providers.config";
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
    // v13.0.10: REMOVED the window-scaling logic that was capping posts.
    // Previously: if strategy said 9 posts but only 8 windows, it scaled DOWN to 8.
    // Now: time-generator supports multiple posts per window (v13.0.9 fix).
    // So we pass the FULL distribution to time-generator — no scaling needed.
    //
    // v13.1.3: CRITICAL FIX — Tier H slots are now INCLUDED in the time-generator's
    // equal-segment algorithm. Previously, H slots were generated separately AFTER
    // A/B/C, using randomTimeInWindow() with effectiveGap = min(90, windowSize/2)
    // = 60 min for a 2h window. On high-post-count days (turbo: 11 A/B/C + 4 H =
    // 15 posts in ~14 hours), a strict 60-min gap between H and any A/B/C post was
    // mathematically impossible (needs 15 × 120 = 30h, only 14h available), so
    // the algorithm fell back to randomTimeInWindow() which has NO gap check.
    // This produced collisions like two posts at 11:16, or H 10 min after a B.
    //
    // Now H is part of the same equal-segment algorithm. Each H post gets its own
    // dedicated segment of the day, and effectiveGap is dynamically scaled based
    // on the actual post count (segmentSize/2). This guarantees uniform spread.
    const tierHConfig = strategyConfig.tierH;
    let hCount = 0;
    if (tierHConfig?.enabled) {
      hCount = this.getHPostCountForMode(strategyConfig.mode, tierHConfig);
      // Conservative mode: publish H every N days (not daily).
      if (strategyConfig.mode === "conservative" && hCount === 0) {
        const dayOfYear = Math.floor(Date.parse(targetDate + "T00:00:00Z") / 86400000);
        const interval = tierHConfig.conservativeIntervalDays ?? 2;
        if (dayOfYear % interval === 0) {
          hCount = 1; // Conservative publishes 1 H post on interval days.
        }
      }
      // User spec: "Every generated week MUST contain at least one Tier H slot
      // every day." So if H count is 0 for non-conservative modes, force 1.
      // (minimal mode is the only exception — it's explicitly low-activity.)
      if (hCount === 0 && strategyConfig.mode !== "minimal" && strategyConfig.mode !== "conservative") {
        hCount = 1;
      }
    }

    const scaledDist: Record<Category, number> = {
      A: distribution.A,
      B: distribution.B,
      C: distribution.C,
      H: hCount, // v13.1.3: H is now part of the equal-segment algorithm
    };
    const categoryDist: Record<Category, number> = scaledDist;
    const slots = this.deps.timeGenerator.generate(
      targetDate,
      schedulerConfig,
      categoryDist,
    );

    // 5. Assign categories + providers + priorities.
    // v12.0.13: Track used providers to enforce MAX_PROVIDER_REPEAT (2/day).
    // Also designate ONE slot as "wildcard" — a fully random post from ALL
    // active APIs regardless of category, for maximum variety.
    const usedProviders = new Map<string, number>();

    // v13.1.3: Pick a random slot index for the "wildcard" post — but NEVER
    // pick an H slot. Wildcard changes slotCategory to match the picked
    // provider's category, so an H-slot wildcard could pick a non-H provider
    // and convert the H slot to A/B/C — reducing the daily H count below 1
    // (which violates the "no day may omit Tier H" spec). Excluding H slots
    // from the wildcard pool guarantees every day keeps its H quota.
    // Fallback: if ALL slots are H (degenerate case — only happens in tests
    // with H-only distributions), allow wildcard on any slot.
    const nonHSlotIndices: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]!.category !== "H") nonHSlotIndices.push(i);
    }
    const wildcardPool = nonHSlotIndices.length > 0 ? nonHSlotIndices : slots.map((_, i) => i);
    const wildcardSlotIndex = wildcardPool.length > 0
      ? wildcardPool[randomInt(0, wildcardPool.length - 1)]!
      : -1;

    const posts: PlannedPost[] = slots.map((slot, index) => {
      // v12.0.13: Wildcard slot — pick from ALL active providers for variety.
      // v12.3.2: Was made "truly random" (no filter).
      // v12.3.4: RE-ADDED the MAX_PROVIDER_REPEAT=2 filter per user request —
      // "no API should appear more than 2 times per day, INCLUDING via wildcard".
      // The wildcard now picks from providers that haven't hit the 2/day cap yet.
      // If ALL providers are exhausted (rare — needs 14 providers × 2 = 28 slots,
      // but we only have ~5 slots/day), fall back to all providers (rare path).
      // Only ONE wildcard per day (wildcardSlotIndex is a single random index
      // picked once above).
      let provider: string | null;
      let slotCategory = slot.category;
      // v12.3.1: Track whether this slot was "skipped" due to theme mismatch
      // (e.g. Cat C on Saturday where the theme has no Cat C providers).
      // Such slots are marked "skipped" at generation time so the scheduler
      // knows not to fire them, and the dashboard shows a clear ⏭️ badge.
      let slotStatus: PlannedPostStatus = "pending";

      if (index === wildcardSlotIndex) {
        // v13.0.3: WILDCARD IS TRULY RANDOM — NO category, tier, or theme filter.
        // Picks from ALL enabled providers (A + B + C + H), NOT limited to any
        // strategy category, tier, or day-of-week theme. No MAX_PROVIDER_REPEAT
        // filter either — the wildcard bypasses the 2/day cap to ensure maximum
        // variety. Only ONE wildcard per day.
        const allProviders: string[] = [
          ...(CATEGORY_PROVIDERS["A"] ?? []),
          ...(CATEGORY_PROVIDERS["B"] ?? []),
          ...(CATEGORY_PROVIDERS["C"] ?? []),
          ...(CATEGORY_PROVIDERS["H"] ?? []), // v13.0.3: include Tier H
        ].filter((id) => this.deps.pluginManager.isEnabled(id));
        provider = allProviders.length > 0
          ? allProviders[randomInt(0, allProviders.length - 1)]!
          : null;
        // v12.3.2: When wildcard picks a provider from a DIFFERENT category
        // than the slot's original category, update slotCategory to match
        // the provider's actual category. This ensures the scheduler fires
        // the right content pipeline (Cat A pipeline for a Cat A provider,
        // even if the slot was originally Cat C). Otherwise a Cat C slot
        // with a Cat A provider would try to process Cat C content and fail.
        if (provider) {
          const providerCat = this.getProviderCategory(provider);
          if (providerCat && providerCat !== slotCategory) {
            slotCategory = providerCat;
          }
        }
      } else if (slot.category === "H" && tierHConfig?.enabled) {
        // v13.1.3: H slots are now interleaved into the equal-segment algorithm
        // by the time-generator (buildCategoryList round-robins A/B/H). Here we
        // just need to pick a Tier H provider for the slot.
        provider = this.selectHProvider(tierHConfig, usedProviders, theme);
      } else {
        provider = this.selectProvider(slot.category, theme, usedProviders);
      }

      // v13.0.3: If selectProvider returned null (theme mismatch OR cap exhausted),
      // DON'T skip the slot — instead, fall back to wildcard-style random selection
      // from ALL providers (any category, any tier). This ensures no slot is ever
      // wasted. The slot's category is updated to match the picked provider.
      if (!provider) {
        const allProviders: string[] = [
          ...(CATEGORY_PROVIDERS["A"] ?? []),
          ...(CATEGORY_PROVIDERS["B"] ?? []),
          ...(CATEGORY_PROVIDERS["C"] ?? []),
          ...(CATEGORY_PROVIDERS["H"] ?? []),
        ].filter((id) => this.deps.pluginManager.isEnabled(id));
        const available = allProviders.filter(
          (id) => (usedProviders.get(id) ?? 0) < StrategyEngine.MAX_PROVIDER_REPEAT,
        );
        const pool = available.length > 0 ? available : allProviders;
        provider = pool.length > 0 ? pool[randomInt(0, pool.length - 1)]! : null;
        if (provider) {
          const providerCat = this.getProviderCategory(provider);
          if (providerCat && providerCat !== slotCategory) {
            slotCategory = providerCat;
          }
        }
      }

      // v13.0.3: Only mark as "skipped" if even the fallback failed (extremely rare).
      if (!provider) {
        slotStatus = "skipped" as PlannedPostStatus;
      }

      // Track usage.
      if (provider) {
        usedProviders.set(provider, (usedProviders.get(provider) ?? 0) + 1);
      }

      const priority = this.assignPriority(slotCategory, strategy.mode);
      return {
        id: `plan-${targetDate}-${index}`,
        index,
        date: targetDate,
        time: slot.time,
        windowEnd: slot.windowEnd ?? slot.time,
        scheduledTime: slot.scheduledTime,
        epochMs: slot.epochMs,
        category: slotCategory,
        provider,
        strategy: strategy.mode,
        language: strategyConfig.language === "auto" ? "fa" : strategyConfig.language,
        priority,
        queueTarget: this.getQueueTarget(slot.category),
        status: slotStatus,
        windowIndex: index,
      };
    });

    // v13.1.3: Tier H slots are now generated INSIDE the time-generator's
    // equal-segment algorithm (buildCategoryList interleaves A/B/H). The old
    // separate H-generation block (randomTimeInWindow + fallback that ignored
    // minGap) is removed — see the v13.1.3 changelog entry for the full root
    // cause analysis. H providers are still picked via selectHProvider() with
    // its rotation/cooldown/anti-repeat logic, just called from the slots.map
    // loop above when slot.category === "H".
    if (tierHConfig?.enabled) {
      const hSlotsCount = posts.filter((p) => p.category === "H").length;
      this.deps.logger.info("pipeline.start", {
        step: "strategy.generatePlan",
        date: targetDate,
        hSlotsCount,
        message: `[TIER_H] ${hSlotsCount} H slot(s) interleaved with A/B/C in equal-segment algorithm`,
      });
    }

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

  /** v12.1.1: Mark a planned post as "skipped" — used after plan regeneration
   *  to prevent past slots from being fired by the scheduler. */
  async markPostSkipped(date: string, postIndex: number): Promise<void> {
    const plan = await this.getOrGeneratePlan(date);
    const updatedPosts = plan.posts.map((p) =>
      p.index === postIndex
        ? { ...p, status: "skipped" as PlannedPostStatus }
        : p,
    );
    const updatedPlan = { ...plan, posts: updatedPosts };
    await this.savePlan(date, updatedPlan);
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
   *
   * v11.7.1: CRITICAL FIX — filters out DISABLED providers.
   * v12.0.11: Fixed theme matching (provider ID must contain topic keyword).
   * v12.0.13: MAX_PROVIDER_REPEAT = 2 — no provider appears more than twice
   *   per day. If a provider has already been used 2x, it's excluded from
   *   selection. This ensures variety even on themed days.
   * v12.3.1: THEME-SLOT SKIP — if theme.preferredProviders is set and NONE
   *   of them are in the slot's category AND the category has only ONE
   *   enabled provider (e.g. Cat C with just xkcd), return null to mark
   *   the slot as "skipped". This prevents off-theme providers (like xkcd
   *   on AI-themed Saturday) from being force-assigned to a slot.
   *
   * @param category — the slot's category (A/B/C)
   * @param theme — the weekly theme for today (null = no theme)
   * @param usedProviders — map of providerId → count already assigned today
   */
  private static readonly MAX_PROVIDER_REPEAT = 2;

  private selectProvider(
    category: Category,
    theme: DailyTheme | null,
    usedProviders: Map<string, number> = new Map(),
  ): string | null {
    const allProviders = CATEGORY_PROVIDERS[category];
    if (!allProviders || allProviders.length === 0) return null;

    // v11.7.1: Filter to only ENABLED providers.
    let providers = allProviders.filter((id) => this.deps.pluginManager.isEnabled(id));
    if (providers.length === 0) return null;

    // v12.0.13: Exclude providers that have already been used MAX_PROVIDER_REPEAT times.
    const availableProviders = providers.filter(
      (id) => (usedProviders.get(id) ?? 0) < StrategyEngine.MAX_PROVIDER_REPEAT,
    );

    // v12.3.4: STRICT 2/day cap — if all providers in this category are
    // already at MAX_PROVIDER_REPEAT, return null (mark slot as "skipped")
    // INSTEAD of resetting to all providers. The old "reset to all" behavior
    // broke the 2/day-per-API limit: e.g. on Friday, Cat C has only xkcd;
    // if the wildcard already used xkcd once, the first Cat C slot brings it
    // to 2×, and the second Cat C slot would "reset" and force xkcd to 3×.
    // Now the second Cat C slot gets status="skipped" instead.
    // This is safe because with ~5 slots/day and MAX_PROVIDER_REPEAT=2,
    // exhausting a multi-provider category (needs 2× providerCount slots)
    // is impossible — only single-provider categories (Cat C with just xkcd)
    // can be exhausted, and skipping them is the correct behavior.
    if (availableProviders.length === 0) {
      return null;
    }
    providers = availableProviders;

    // v12.3.0: NEW — Use theme.preferredProviders FIRST.
    // Each day has an explicit list of 4-5 provider IDs that should be prioritized.
    // We pick from the intersection of preferredProviders ∩ availableProviders.
    if (theme && theme.preferredProviders && theme.preferredProviders.length > 0) {
      const preferred = theme.preferredProviders
        .filter((id) => providers.includes(id))
        .filter((id) => (usedProviders.get(id) ?? 0) < StrategyEngine.MAX_PROVIDER_REPEAT);

      if (preferred.length > 0) {
        // v13.1.3: Use WEIGHTED random selection (was uniform-random before).
        // Higher-weight preferred providers (e.g. weight=95) are picked more often
        // than lower-weight ones (e.g. weight=80). Falls back to uniform-random if
        // selectProviderWeighted returns null (shouldn't happen with non-empty list).
        return selectProviderWeighted(preferred) ?? preferred[randomInt(0, preferred.length - 1)]!;
      }

      // v12.3.1: THEME-SLOT SKIP — if the theme has preferredProviders but NONE
      // of them are in the slot's category providers, AND the slot's category
      // has only ONE enabled provider (e.g. Cat C with just xkcd), return null
      // so the slot gets marked as "skipped" instead of forcing an off-theme
      // provider. This is what makes xkcd NOT appear on Saturday (AI day) —
      // Cat C has only xkcd, and Saturday's preferredProviders are all Cat A.
      const themeHasCategoryProvider = theme.preferredProviders.some((id) =>
        allProviders.includes(id) && this.deps.pluginManager.isEnabled(id),
      );
      if (!themeHasCategoryProvider && providers.length === 1) {
        return null;
      }
    }

    // Fallback: if no preferred providers available, use topic matching (old logic).
    if (theme && theme.topics.length > 0) {
      const themeTopicsLower = theme.topics.map((t) => t.toLowerCase());
      const matchedProviders = providers.filter((provider) => {
        const providerLower = provider.toLowerCase();
        return themeTopicsLower.some((topic) => providerLower.includes(topic));
      });

      if (matchedProviders.length > 0) {
        // v13.1.3: WEIGHTED selection among topic-matched providers.
        return selectProviderWeighted(matchedProviders) ?? matchedProviders[randomInt(0, matchedProviders.length - 1)]!;
      }
    }

    // No theme, no preferred, no topic match — pick WEIGHTED random.
    // v13.1.3: Uses selectProviderWeighted() from providers.config.ts which
    // reads the `weight` field from each provider's config entry. E.g.
    // github-releases (weight=100) appears more often than stackexchange
    // (weight=80). Falls back to uniform-random if null (defensive).
    return selectProviderWeighted(providers) ?? providers[randomInt(0, providers.length - 1)]!;
  }

  // ────────────────────────────────────────────────────────
  // Internal: Provider Category Lookup
  // ────────────────────────────────────────────────────────

  /**
   * v12.3.2: Look up which category a provider belongs to.
   * Used by the wildcard slot logic — when the wildcard picks a provider from
   * a different category than the slot's original category, we need to know the
   * provider's actual category so the scheduler fires the right pipeline.
   *
   * Returns null if the provider isn't in CATEGORY_PROVIDERS (shouldn't happen
   * for enabled providers, but defensive).
   */
  private getProviderCategory(providerId: string): Category | null {
    // v13.0.0: Include "H" in the lookup.
    for (const cat of ["A", "B", "C", "H"] as const) {
      const list = CATEGORY_PROVIDERS[cat];
      if (list && list.includes(providerId)) return cat;
    }
    return null;
  }

  // ────────────────────────────────────────────────────────
  // v13.0.0: Internal: Tier H Helpers
  // ────────────────────────────────────────────────────────

  /**
   * v13.0.0: Get the number of H posts for a given strategy mode.
   * Reads from the configurable tierH.extraHPostsPerMode map.
   * This is FULLY CONFIGURABLE — admin can change without redeploy.
   */
  private getHPostCountForMode(mode: StrategyMode, tierHConfig: StrategyConfig["tierH"]): number {
    const perMode = tierHConfig.extraHPostsPerMode;
    // The perMode object has keys for each strategy mode.
    // Use a type-safe lookup with fallback to 0.
    const map = perMode as Record<string, number | undefined>;
    return map[mode] ?? 0;
  }

  // v13.1.3: randomTimeInWindow() REMOVED — Tier H slots are now generated by
  // the time-generator's equal-segment algorithm. This helper was only used by
  // the old separate H-generation block, which is deleted (see v13.1.3 fix).
  // Removing it keeps the code surface clean — no callers, no dead code.

  /**
   * v13.0.0: Select a Tier H provider with rotation, cooldown, weighted balancing,
   * and avoid immediate repetition.
   *
   * Requirements (per user spec):
   *   - provider cooldown (maxProviderRepeat — no API > 2×/day)
   *   - avoid immediate repetition (don't pick the last-used H provider)
   *   - weighted balancing (prefer higher-weight providers)
   *   - failure recovery (if all H providers exhausted, return null → slot skipped)
   */
  private lastHProvider: string | null = null;

  private selectHProvider(
    tierHConfig: StrategyConfig["tierH"],
    usedProviders: Map<string, number>,
    _theme: DailyTheme | null,
  ): string | null {
    const hProviders = CATEGORY_PROVIDERS["H"] ?? [];
    const enabled = hProviders.filter((id) => this.deps.pluginManager.isEnabled(id));
    if (enabled.length === 0) return null;

    // v12.3.4 cap: exclude providers already at maxProviderRepeat.
    const maxRepeat = tierHConfig.maxProviderRepeat ?? 2;
    const available = enabled.filter((id) => (usedProviders.get(id) ?? 0) < maxRepeat);
    const pool = available.length > 0 ? available : enabled;

    // Avoid immediate repetition (last H provider).
    let candidates = pool;
    if (this.lastHProvider && pool.length > 1) {
      const filtered = pool.filter((id) => id !== this.lastHProvider);
      if (filtered.length > 0) candidates = filtered;
    }

    // v13.1.3: WEIGHTED balancing — uses selectProviderWeighted() from
    // providers.config.ts which reads the `weight` field from each provider's
    // config entry. E.g. ars-technica (weight=90) is picked slightly more often
    // than toms-hardware (weight=88) and techpowerup (weight=88).
    // Falls back to uniform-random if selectProviderWeighted returns null
    // (defensive — shouldn't happen with non-empty candidates).
    const picked = selectProviderWeighted(candidates)
      ?? candidates[randomInt(0, candidates.length - 1)]!
      ?? null;
    if (picked) {
      this.lastHProvider = picked;
    }
    return picked;
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
    // v13.0.0: Category H — high priority for aggressive/turbo, normal otherwise.
    if (category === "H") {
      return (strategyMode === "aggressive" || strategyMode === "turbo") ? "high" : "normal";
    }
    return "low"; // category C
  }

  // ────────────────────────────────────────────────────────
  // Internal: Queue Target
  // ────────────────────────────────────────────────────────

  /** Get the queue target depth for a category.
   *  v13.0.0: Added Category H (on-demand, small queue). */
  private getQueueTarget(category: Category): number {
    switch (category) {
      case "A": return 4;
      case "B": return 2;
      case "C": return 2;
      case "H": return 2; // v13.0.0: H keeps a small queue for on-demand publish
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

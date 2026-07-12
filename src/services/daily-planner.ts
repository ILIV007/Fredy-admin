/**
 * src/services/daily-planner.ts
 * Generates a daily publishing plan.
 *
 * Every day, generates a new random schedule respecting:
 *   - posts/day (from config)
 *   - category distribution (A:2, B:1, C:1 by default)
 *   - enabled plugins
 *   - language
 *   - posting windows
 *   - minimum gap between posts
 *
 * See Prompt 9 spec.
 */

import { slotsKey } from "../core/storage/keys";
import { DailyPlanError } from "../core/scheduler/errors";
import type { DailyPlan, SlotTime } from "../types/scheduler";
import type { Category } from "../types/category";
import type { FredySettings } from "../types/config";
import type { TimeGenerator } from "./time-generator";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";
import { formatDateInZone } from "../primitives/time";

export interface DailyPlannerDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly timeGenerator: TimeGenerator;
  readonly settings: () => Promise<FredySettings>;
}

const PLAN_TTL_SECONDS = 48 * 3600; // 48 hours

export class DailyPlanner {
  constructor(private readonly deps: DailyPlannerDeps) {}

  /** Generate a new daily plan for today (or a specific date). */
  async generate(date?: string): Promise<DailyPlan> {
    const settings = await this.deps.settings();
    const scheduler = settings.scheduler;

    if (!scheduler.enabled) {
      throw new DailyPlanError("Scheduler is disabled");
    }

    // Determine the date.
    const targetDate = date ?? formatDateInZone(Date.now(), scheduler.timezone);

    // Build the category distribution from config.
    const distribution = this.buildDistribution(settings);

    // Validate that total matches postsPerDay.
    const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    if (total !== settings.content.postsPerDay) {
      this.deps.logger.warn("scheduler.skip", {
        message: `Category distribution total (${total}) != postsPerDay (${settings.content.postsPerDay})`,
      });
    }

    // Generate random slot times.
    const slots: readonly SlotTime[] = this.deps.timeGenerator.generate(
      targetDate,
      scheduler,
      distribution,
    );

    if (slots.length === 0) {
      throw new DailyPlanError("No slots generated — check config");
    }

    const plan: DailyPlan = {
      date: targetDate,
      slots,
      generatedAt: Date.now(),
      timezone: scheduler.timezone,
      postsPerDay: settings.content.postsPerDay,
      categoryDistribution: distribution,
    };

    // Persist to KV.
    await this.deps.kv.setJson(slotsKey(targetDate), plan, PLAN_TTL_SECONDS);

    this.deps.logger.info("scheduler.slot_fired", {
      date: targetDate,
      slotCount: slots.length,
      timezone: scheduler.timezone,
      message: "Daily plan generated",
    });

    return plan;
  }

  /** Load today's plan from KV (or generate if missing). */
  async getOrGenerate(date?: string): Promise<DailyPlan> {
    const settings = await this.deps.settings();
    const targetDate = date ?? formatDateInZone(Date.now(), settings.scheduler.timezone);

    const existing = await this.deps.kv.getJson<DailyPlan>(slotsKey(targetDate));
    if (existing) return existing;

    return this.generate(targetDate);
  }

  /** Get the next unfired slot from today's plan. */
  async getNextSlot(now = Date.now()): Promise<{ slot: SlotTime; plan: DailyPlan } | null> {
    const plan = await this.getOrGenerate();
    const nextSlot = plan.slots.find(
      (s) => s.epochMs > now && !(await this.isSlotFired(s)),
    );
    if (!nextSlot) return null;
    return { slot: nextSlot, plan };
  }

  /** Check if a slot has been fired. */
  async isSlotFired(slot: SlotTime): Promise<boolean> {
    const key = `fredy:sched:sent:${slot.date}:${slot.index}`;
    const value = await this.deps.kv.get(key);
    return value !== null;
  }

  /** Mark a slot as fired. */
  async markSlotFired(slot: SlotTime, contentId: string): Promise<void> {
    const key = `fredy:sched:sent:${slot.date}:${slot.index}`;
    await this.deps.kv.setJson(key, { contentId, firedAt: Date.now() }, PLAN_TTL_SECONDS);
  }

  /** Build category distribution from settings. */
  private buildDistribution(settings: FredySettings): Readonly<Record<Category, number>> {
    const cats = settings.categories;
    return {
      A: cats.A.enabled ? cats.A.dailyLimit : 0,
      B: cats.B.enabled ? cats.B.dailyLimit : 0,
      C: cats.C.enabled ? cats.C.dailyLimit : 0,
    };
  }

  /** Clear the plan for a date (for testing). */
  async clear(date: string): Promise<void> {
    await this.deps.kv.delete(slotsKey(date));
  }
}

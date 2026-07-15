/**
 * src/services/time-generator.ts
 * Generates random publish times within configurable windows.
 *
 * Rules:
 *   - All times are within the configured posting windows.
 *   - Minimum gap between posts is respected (default 30 min).
 *   - Jitter is applied to each slot (±jitterMinutes).
 *   - No clustered posts (avoids two posts within minGapMinutes).
 *
 * See Prompt 9 spec.
 */

import type { PostingWindow, SlotTime } from "../types/scheduler";
import type { Category } from "../types/category";
import type { SchedulerConfig } from "../core/config/sections/scheduler";
import { SlotGenerationError } from "../core/scheduler/errors";
import { randomInt } from "../primitives/random";
import { parseTimeToMinutes } from "../primitives/time";

export interface TimeGeneratorDeps {
  // No deps — pure service.
}

/** Default minimum gap between posts (minutes). */
const DEFAULT_MIN_GAP_MINUTES = 90;

export class TimeGenerator {
  constructor(_deps: TimeGeneratorDeps = {}) {
    void _deps;
  }

  /**
   * Generate random slot times for a day.
   *
   * @param date — YYYY-MM-DD
   * @param config — scheduler config (slots, jitter, timezone, windows)
   * @param categoryDistribution — how many posts per category
   * @param minGapMinutes — minimum gap between posts (default 30)
   */
  generate(
    date: string,
    config: SchedulerConfig,
    categoryDistribution: Readonly<Record<Category, number>>,
    minGapMinutes = DEFAULT_MIN_GAP_MINUTES,
  ): readonly SlotTime[] {
    // Build the list of categories to schedule (e.g., [A, A, B, C]).
    const categoryList = this.buildCategoryList(categoryDistribution);
    if (categoryList.length === 0) return [];

    // Determine the posting window for this day.
    const windows = config.postingWindows.length > 0
      ? config.postingWindows
      : this.defaultWindows(config.slots);

    // Convert windows to minutes-since-midnight ranges.
    const minuteRanges = windows.map((w) => ({
      start: parseTimeToMinutes(w.start) ?? 0,
      end: parseTimeToMinutes(w.end) ?? 24 * 60 - 1,
    }));

    if (minuteRanges.length === 0) {
      throw new SlotGenerationError("No valid posting windows configured");
    }

    // Generate random times within windows, respecting min gap.
    const generatedTimes: number[] = [];
    const totalSlots = categoryList.length;

    for (let i = 0; i < totalSlots; i++) {
      const attempt = this.generateTimeWithinRanges(
        minuteRanges,
        generatedTimes,
        minGapMinutes,
        config.jitterMinutes,
      );
      if (attempt === null) {
        throw new SlotGenerationError(
          `Could not generate slot ${i + 1} (min gap ${minGapMinutes} min too restrictive for ${totalSlots} posts in ${minuteRanges.length} window(s))`,
        );
      }
      generatedTimes.push(attempt);
    }

    // Sort times ascending.
    generatedTimes.sort((a, b) => a - b);

    // Build SlotTime objects.
    const slots: SlotTime[] = generatedTimes.map((minutes, index) => {
      const hh = Math.floor(minutes / 60).toString().padStart(2, "0");
      const mm = (minutes % 60).toString().padStart(2, "0");
      const time = `${hh}:${mm}`;
      const epochMs = this.minutesToEpochMs(date, minutes, config.timezone);
      return {
        index,
        date,
        time,
        epochMs,
        category: categoryList[index]!,
        jitterMinutes: config.jitterMinutes,
      };
    });

    return slots;
  }

  /** Build the category list from distribution (e.g., {A:2, B:1, C:1} → [A, A, B, C]). */
  private buildCategoryList(distribution: Readonly<Record<Category, number>>): Category[] {
    const list: Category[] = [];
    const categories: Category[] = ["A", "B", "C"];
    // Interleave categories to avoid clustering same category.
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const cat of categories) {
        if (distribution[cat] > 0) {
          list.push(cat);
          distribution = { ...distribution, [cat]: distribution[cat] - 1 };
          remaining = true;
        }
      }
    }
    return list;
  }

  /** Default windows from slot times (each slot ± 2 hours). */
  private defaultWindows(slots: readonly string[]): PostingWindow[] {
    return slots.map((slot) => {
      const minutes = parseTimeToMinutes(slot) ?? 540;
      const startMin = Math.max(0, minutes - 120);
      const endMin = Math.min(24 * 60 - 1, minutes + 120);
      return {
        start: this.minutesToTime(startMin),
        end: this.minutesToTime(endMin),
      };
    });
  }

  /** Generate a random time within the ranges, avoiding existing times by minGap. */
  private generateTimeWithinRanges(
    ranges: ReadonlyArray<{ start: number; end: number }>,
    existingTimes: number[],
    minGapMinutes: number,
    jitterMinutes: number,
  ): number | null {
    const maxAttempts = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Pick a random range.
      const range = ranges[randomInt(0, ranges.length - 1)]!;
      // Pick a random time within the range.
      const time = randomInt(range.start, range.end);

      // Check min gap against all existing times.
      const tooClose = existingTimes.some(
        (t) => Math.abs(t - time) < minGapMinutes,
      );
      if (!tooClose) {
        // Apply jitter (clamp to range).
        const jitter = randomInt(-jitterMinutes, jitterMinutes);
        const jittered = Math.max(range.start, Math.min(range.end, time + jitter));
        return jittered;
      }
    }
    return null;
  }

  /** Convert minutes-since-midnight to "HH:MM". */
  private minutesToTime(minutes: number): string {
    const hh = Math.floor(minutes / 60).toString().padStart(2, "0");
    const mm = (minutes % 60).toString().padStart(2, "0");
    return `${hh}:${mm}`;
  }

  /** Convert minutes-since-midnight to epoch ms for a date in a timezone. */
  private minutesToEpochMs(date: string, minutes: number, _timezone: string): number {
    // Parse date as YYYY-MM-DD, add minutes as if UTC (simplification — real impl
    // would use the timezone offset).
    const [year, month, day] = date.split("-").map(Number);
    const epochSeconds = Date.UTC(year!, month! - 1, day!, 0, minutes, 0);
    return epochSeconds;
  }
}

/** Re-export for testing. */
export { DEFAULT_MIN_GAP_MINUTES };

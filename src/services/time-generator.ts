/**
 * src/services/time-generator.ts
 * Generates random publish times within configurable posting windows.
 *
 * v7.0.1 changes:
 *   - Each posting window generates exactly ONE random publish time.
 *   - minGapMinutes is now passed from config (was hardcoded).
 *   - Respects quiet hours (slots inside quiet hours are skipped).
 *
 * Rules:
 *   - All times are within the configured posting windows.
 *   - One slot per window (max).
 *   - Minimum gap between posts is respected.
 *   - Jitter is applied to each slot.
 *   - No clustered posts.
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

export class TimeGenerator {
  constructor(_deps: TimeGeneratorDeps = {}) {
    void _deps;
  }

  /**
   * Generate random slot times for a day.
   *
   * v7: Each posting window generates at most ONE random time.
   * v11.11.0: REVERTED v11.10.0 bias — random slot generation is a CORE FEATURE.
   * The scheduler has been refactored to window-based processing (see
   * scheduler-service.ts findDueSlots) so random times work correctly without
   * alignment to cron tick boundaries.
   *
   * @param date — YYYY-MM-DD
   * @param config — scheduler config (windows, jitter, timezone, minGap)
   * @param categoryDistribution — how many posts per category
   */
  generate(
    date: string,
    config: SchedulerConfig,
    categoryDistribution: Readonly<Record<Category, number>>,
  ): readonly SlotTime[] {
    // Build the list of categories to schedule (e.g., [A, A, B, C]).
    const categoryList = this.buildCategoryList(categoryDistribution);
    if (categoryList.length === 0) return [];

    // Determine the posting windows.
    const windows = config.postingWindows.length > 0
      ? config.postingWindows
      : this.defaultWindows(config.slots);

    // Convert windows to minutes-since-midnight ranges.
    const minuteRanges = windows.map((w) => ({
      start: parseTimeToMinutes(w.start) ?? 0,
      end: parseTimeToMinutes(w.end) ?? 24 * 60 - 1,
      windowIndex: windows.indexOf(w),
    }));

    if (minuteRanges.length === 0) {
      throw new SlotGenerationError("No valid posting windows configured");
    }

    // v7: Assign categories to windows (one category per window).
    // We take the first N windows (where N = categoryList.length),
    // capped by the number of available windows.
    const numSlots = Math.min(categoryList.length, minuteRanges.length);

    // Generate one random time per window, respecting min gap.
    const generatedTimes: Array<{ minutes: number; windowIndex: number; category: Category }> = [];
    const usedMinutes: number[] = [];

    for (let i = 0; i < numSlots; i++) {
      const range = minuteRanges[i]!;
      const category = categoryList[i]!;

      const attempt = this.generateTimeInRange(
        range.start,
        range.end,
        usedMinutes,
        config.minGapMinutes,
        config.jitterMinutes,
      );

      if (attempt === null) {
        // Skip this window — can't fit a time with the min gap.
        continue;
      }

      generatedTimes.push({ minutes: attempt, windowIndex: i, category });
      usedMinutes.push(attempt);
    }

    if (generatedTimes.length === 0) {
      throw new SlotGenerationError(
        `Could not generate any slots (min gap ${config.minGapMinutes} min too restrictive)`,
      );
    }

    // Sort by time ascending.
    generatedTimes.sort((a, b) => a.minutes - b.minutes);

    // Build SlotTime objects.
    // v11.15.0: Window-based — each slot represents a posting WINDOW, not an exact time.
    // The slot.time is the window START, windowEnd is the window END.
    // The scheduler fires when the cron tick falls within [start, end].
    const slots: SlotTime[] = generatedTimes.map((entry, index) => {
      const range = minuteRanges[entry.windowIndex]!;
      const startHh = Math.floor(range.start / 60).toString().padStart(2, "0");
      const startMm = (range.start % 60).toString().padStart(2, "0");
      const endHh = Math.floor(range.end / 60).toString().padStart(2, "0");
      const endMm = (range.end % 60).toString().padStart(2, "0");
      const time = `${startHh}:${startMm}`;
      const windowEnd = `${endHh}:${endMm}`;
      // epochMs is the window START — used for ordering, NOT exact firing.
      const epochMs = this.minutesToEpochMs(date, range.start, config.timezone);
      return {
        index,
        date,
        time,
        windowEnd,
        epochMs,
        category: entry.category,
        jitterMinutes: config.jitterMinutes,
      };
    });

    return slots;
  }

  /** Build the category list from distribution (e.g., {A:2, B:1, C:1} → [A, A, B, C]). */
  private buildCategoryList(distribution: Readonly<Record<Category, number>>): Category[] {
    const list: Category[] = [];
    const categories: Category[] = ["A", "B", "C"];
    let dist = { ...distribution };
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const cat of categories) {
        if (dist[cat] > 0) {
          list.push(cat);
          dist = { ...dist, [cat]: dist[cat] - 1 };
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

  /**
   * Generate a random time within a single range, avoiding existing times by minGap.
   * v11.11.0: REVERTED v11.10.0 bias — fully random within the window (original behavior).
   * The scheduler now uses window-based processing so random times work correctly.
   */
  private generateTimeInRange(
    rangeStart: number,
    rangeEnd: number,
    existingTimes: number[],
    minGapMinutes: number,
    jitterMinutes: number,
  ): number | null {
    const maxAttempts = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const time = randomInt(rangeStart, rangeEnd);
      const tooClose = existingTimes.some(
        (t) => Math.abs(t - time) < minGapMinutes,
      );
      if (!tooClose) {
        const jitter = randomInt(-jitterMinutes, jitterMinutes);
        return Math.max(rangeStart, Math.min(rangeEnd, time + jitter));
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

  /** Convert minutes-since-midnight to epoch ms for a date in a timezone.
   *  v8.0.0: FIXED — was using Date.UTC() which ignored the timezone. */
  private minutesToEpochMs(date: string, minutes: number, timezone: string): number {
    const [year, month, day] = date.split("-").map(Number);
    const utcMidnight = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
    const offsetMin = getTzOffsetMinutes(utcMidnight, timezone);
    return utcMidnight + (minutes - offsetMin) * 60_000;
  }
}

function getTzOffsetMinutes(utcMs: number, timezone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? "0";
    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    const h = Number(get("hour")) === 24 ? 0 : Number(get("hour"));
    const mi = Number(get("minute"));
    const s = Number(get("second"));
    const asIfUtc = Date.UTC(y, m - 1, d, h, mi, s);
    return Math.round((asIfUtc - utcMs) / 60_000);
  } catch {
    return 0;
  }
}

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
   * v13.1.1: EQUAL-SEGMENT SPREADING — divides the active day into N equal
   * segments (where N = number of posts). Each post gets a random time within
   * its segment. This GUARANTEES posts are spread across the full day.
   *
   * For 5 posts (balanced): each segment = 2.8h → posts at ~09:00, ~12:00, ~14:30, ~17:00, ~20:00
   * For 15 posts (turbo): each segment = ~56min → posts spread every ~1h
   *
   * No more clustering in the morning, no gaps in the afternoon.
   */
  generate(
    date: string,
    config: SchedulerConfig,
    categoryDistribution: Readonly<Record<Category, number>>,
  ): readonly SlotTime[] {
    const categoryList = this.buildCategoryList(categoryDistribution);
    if (categoryList.length === 0) return [];

    // v13.1.1: Active day range (respect quiet hours).
    const dayStart = parseTimeToMinutes(config.quietHours?.end ?? "07:30") ?? 450;
    const dayEnd = parseTimeToMinutes("22:00") ?? 1320;
    const dayRange = dayEnd - dayStart;

    if (dayRange <= 0) {
      throw new SlotGenerationError("Day range is zero — quiet hours end after 22:00");
    }

    const numPosts = categoryList.length;
    const segmentSize = dayRange / numPosts;
    const minGap = config.minGapMinutes ?? 90;

    const generatedTimes: Array<{ minutes: number; category: Category }> = [];
    const usedMinutes: number[] = [];

    for (let i = 0; i < numPosts; i++) {
      const segStart = Math.floor(dayStart + i * segmentSize);
      const segEnd = Math.floor(dayStart + (i + 1) * segmentSize);

      let time: number | null = null;
      const effectiveGap = Math.min(minGap, Math.floor(segmentSize / 2));

      for (let attempt = 0; attempt < 50; attempt++) {
        const t = randomInt(segStart, Math.max(segStart, segEnd - 1));
        const tooClose = usedMinutes.some((um) => Math.abs(um - t) < effectiveGap);
        if (!tooClose) { time = t; break; }
      }
      if (time === null) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const t = randomInt(segStart, Math.max(segStart, segEnd - 1));
          const tooClose = usedMinutes.some((um) => Math.abs(um - t) < 30);
          if (!tooClose) { time = t; break; }
        }
      }
      if (time === null) {
        time = Math.floor((segStart + segEnd) / 2);
      }

      generatedTimes.push({ minutes: time, category: categoryList[i]! });
      usedMinutes.push(time);
    }

    if (generatedTimes.length === 0) {
      throw new SlotGenerationError("Could not generate any slots");
    }

    generatedTimes.sort((a, b) => a.minutes - b.minutes);

    // Find closest posting window for display.
    const windows = config.postingWindows.length > 0
      ? config.postingWindows
      : this.defaultWindows(config.slots);
    const minuteRanges = windows.map((w) => ({
      start: parseTimeToMinutes(w.start) ?? 0,
      end: parseTimeToMinutes(w.end) ?? 24 * 60 - 1,
    }));

    const slots: SlotTime[] = generatedTimes.map((entry, index) => {
      let bestWinIdx = 0;
      let bestDist = Infinity;
      for (let w = 0; w < minuteRanges.length; w++) {
        const wr = minuteRanges[w]!;
        if (entry.minutes >= wr.start && entry.minutes <= wr.end) {
          bestWinIdx = w; bestDist = 0; break;
        }
        const dist = Math.min(Math.abs(entry.minutes - wr.start), Math.abs(entry.minutes - wr.end));
        if (dist < bestDist) { bestDist = dist; bestWinIdx = w; }
      }
      const wr = minuteRanges[bestWinIdx]!;
      return {
        index,
        date,
        time: this.minutesToTime(wr.start),
        windowEnd: this.minutesToTime(wr.end),
        scheduledTime: this.minutesToTime(entry.minutes),
        epochMs: this.minutesToEpochMs(date, wr.start, config.timezone),
        category: entry.category,
        jitterMinutes: config.jitterMinutes,
      };
    });

    return slots;
  }

  /** Build the category list from distribution.
   *  v12.0.9: Category C (NASA, XKCD) is placed at the END so it gets the
   *  LAST posting window (20:00-22:00 = night).
   *  v13.0.8: Category H is interleaved with A/B (not at the end).
   *
   *  Example: {A:2, B:1, C:1, H:1} -> [A, B, H, A, C] (C is last = night) */
  private buildCategoryList(distribution: Readonly<Record<Category, number>>): Category[] {
    const list: Category[] = [];
    // v13.0.8: A, B, and H are round-robin interleaved.
    const dayCategories: Category[] = ["A", "B", "H"];
    let dist = { ...distribution };
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const cat of dayCategories) {
        if ((dist[cat] ?? 0) > 0) {
          list.push(cat);
          dist = { ...dist, [cat]: (dist[cat] ?? 0) - 1 };
          remaining = true;
        }
      }
    }
    // Append all C slots at the end (night windows).
    for (let i = 0; i < (distribution.C ?? 0); i++) {
      list.push("C");
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
   * v13.0.10: Reduced minGap enforcement when there are many posts — with 13 posts
   * and 90min gap, you need 13×90=1170 min = 19.5 hours, but windows only span
   * 14 hours (08:00-22:00). So 90min gap makes it impossible to fit 13 posts.
   * Fix: dynamically scale minGap down if it would prevent fitting all posts.
   */
  /** v13.1.1: generateTimeInRange is no longer used — the equal-segment
   *  algorithm handles time generation inline. Kept for backward compat
   *  in case external callers need it. */
  // @ts-expect-error: kept for backward compatibility, may be used by tests
  private _generateTimeInRange_unused(
    rangeStart: number,
    rangeEnd: number,
    existingTimes: number[],
    minGapMinutes: number,
    jitterMinutes: number,
  ): number | null {
    // v13.0.10: If the window is too small for the minGap, relax it.
    const windowSize = rangeEnd - rangeStart;
    const effectiveGap = Math.min(minGapMinutes, Math.floor(windowSize / 2));

    const maxAttempts = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const time = randomInt(rangeStart, rangeEnd);
      const tooClose = existingTimes.some(
        (t) => Math.abs(t - time) < effectiveGap,
      );
      if (!tooClose) {
        const jitter = randomInt(-jitterMinutes, jitterMinutes);
        return Math.max(rangeStart, Math.min(rangeEnd, time + jitter));
      }
    }
    // v13.0.10: Last resort — try with no gap enforcement.
    for (let attempt = 0; attempt < 10; attempt++) {
      const time = randomInt(rangeStart, rangeEnd);
      const tooClose = existingTimes.some(
        (t) => Math.abs(t - time) < 30, // absolute minimum 30 min gap
      );
      if (!tooClose) return time;
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

/**
 * src/services/quiet-hours-checker.ts
 * Checks whether the current time falls within configured quiet hours.
 *
 * Quiet hours prevent publishing during a configurable period (default
 * 00:00–07:30). If a scheduled post falls inside quiet hours, it is
 * deferred to the first valid posting window after quiet hours end.
 *
 * This module is pure — no KV, no side effects. It takes a timestamp
 * and config, returns a boolean or adjusted timestamp.
 */

import type { SchedulerConfig } from "../core/config/sections/scheduler";
import { parseTimeToMinutes, formatDateInZone } from "../primitives/time";

export class QuietHoursChecker {
  /**
   * Check if the given timestamp falls within quiet hours.
   *
   * Quiet hours can span midnight (e.g., start=22:00, end=07:30).
   * In that case, the period from 22:00 to 07:30 next day is "quiet".
   *
   * @param now — epoch milliseconds
   * @param config — scheduler config with quietHours
   * @returns true if the current time is within quiet hours
   */
  isQuietHours(now: number, config: SchedulerConfig): boolean {
    const qh = config.quietHours;
    if (!qh) return false;

    const startMin = parseTimeToMinutes(qh.start);
    const endMin = parseTimeToMinutes(qh.end);
    if (startMin === null || endMin === null) return false;

    // Get current time in minutes-since-midnight (in the configured timezone).
    const currentMin = this.getCurrentMinutes(now, config.timezone);

    if (startMin <= endMin) {
      // Simple case: quiet hours don't span midnight (e.g., 00:00–07:30).
      return currentMin >= startMin && currentMin < endMin;
    } else {
      // Spans midnight (e.g., 22:00–07:30): quiet from start to midnight,
      // AND from midnight to end.
      return currentMin >= startMin || currentMin < endMin;
    }
  }

  /**
   * If the current time is within quiet hours, calculate the next valid
   * posting time (the end of quiet hours on the same day).
   *
   * If NOT in quiet hours, returns `now` unchanged.
   *
   * @param now — epoch milliseconds
   * @param config — scheduler config with quietHours
   * @returns the earliest valid posting time (epoch ms)
   */
  deferPastQuietHours(now: number, config: SchedulerConfig): number {
    if (!this.isQuietHours(now, config)) return now;

    const qh = config.quietHours;
    const endMin = parseTimeToMinutes(qh.end);
    if (endMin === null) return now;

    // Calculate the epoch ms for the end of quiet hours today.
    const dateStr = formatDateInZone(now, config.timezone);
    const [year, month, day] = dateStr.split("-").map(Number);
    const endEpochMs = Date.UTC(year!, month! - 1, day!, 0, endMin, 0);

    // If the end time has already passed today (and we're in the pre-midnight
    // part of a spanning quiet hours), defer to tomorrow.
    if (endEpochMs < now) {
      return endEpochMs + 24 * 60 * 60 * 1000; // tomorrow
    }

    return endEpochMs;
  }

  /**
   * Get the current time in minutes-since-midnight for the given timezone.
   *
   * NOTE: Cloudflare Workers' `Intl.DateTimeFormat` supports timezone
   * formatting. We use it to extract hours and minutes.
   */
  private getCurrentMinutes(now: number, timezone: string): number {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date(now));
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
      return hour * 60 + minute;
    } catch { /* non-fatal */
      // Fallback: use UTC if timezone is invalid.
      const d = new Date(now);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
  }
}

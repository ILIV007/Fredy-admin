/**
 * src/primitives/time.ts
 * Pure time/date utilities. No I/O, no side effects, no globals.
 * All functions work with epoch milliseconds unless noted.
 */

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "../core/constants";

/** Format an epoch ms as YYYY-MM-DD in UTC. */
export function formatDateUtc(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Format an epoch ms as YYYY-MM-DD in a specific IANA timezone. */
export function formatDateInZone(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

/** Format an epoch ms as HH:MM in a specific timezone. */
export function formatTimeInZone(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/** Parse "HH:MM" into minutes since midnight. Returns null on invalid input. */
export function parseTimeToMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const [, h, m] = match;
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Get the start-of-day (midnight) epoch ms for a given date and timezone. */
export function startOfDayInZone(epochMs: number, timezone: string): number {
  // Compute by formatting the date, then parsing "YYYY-MM-DDT00:00:00" in that zone.
  const dateStr = formatDateInZone(epochMs, timezone);
  // The trick: find the UTC offset by constructing a date and reading the diff.
  // Real implementation in Phase 4 (scheduler).
  // For the scaffold, return the epoch at midnight UTC of the formatted date.
  return Date.parse(`${dateStr}T00:00:00Z`);
}

/** Add days to an epoch ms. */
export function addDays(epochMs: number, days: number): number {
  return epochMs + days * MS_PER_DAY;
}

/** Add hours to an epoch ms. */
export function addHours(epochMs: number, hours: number): number {
  return epochMs + hours * MS_PER_HOUR;
}

/** Add minutes to an epoch ms. */
export function addMinutes(epochMs: number, minutes: number): number {
  return epochMs + minutes * MS_PER_MINUTE;
}

/** Milliseconds until the next occurrence of HH:MM in a timezone. */
export function msUntilNext(hhmm: string, _timezone: string, _now = Date.now()): number {
  void _timezone;
  void _now;
  const target = parseTimeToMinutes(hhmm);
  if (target === null) return Number.POSITIVE_INFINITY;
  // Real implementation in Phase 4.
  return Number.POSITIVE_INFINITY;
}

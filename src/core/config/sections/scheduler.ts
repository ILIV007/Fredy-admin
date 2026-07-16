/**
 * src/core/config/sections/scheduler.ts
 * Runtime-configurable scheduler settings.
 *
 * All scheduler behavior is driven by this config section, loaded from KV.
 * Changes take effect on the next tick — no redeployment required.
 *
 * v7.0.1 changes:
 *   - Added quietHours (start/end) — no posts during this period.
 *   - Added lockTimeoutSec — distributed lock expiration (was hardcoded 90).
 *   - Added minGapMinutes — minimum gap between posts (was hardcoded 90).
 *   - Added publishingMode — "auto" | "manual" | "scheduled".
 *   - Default postingWindows now populated with 5 windows (was empty).
 */

import { z } from "zod";

export const timeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const quietHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/).default("00:00"),
  end: z.string().regex(/^\d{2}:\d{2}$/).default("07:30"),
});

export const schedulerSchema = z.object({
  _version: z.literal(2),
  enabled: z.boolean(),
  // Legacy fixed slots — kept for backward compat but postingWindows
  // takes precedence when non-empty.
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(0).max(12),
  jitterMinutes: z.number().int().min(0).max(120),
  timezone: z.string().min(1),
  // v7: Posting windows — each window generates ONE random publish time
  // per day. Replaces the fixed slots approach.
  postingWindows: z.array(timeWindowSchema).default([
    { start: "08:00", end: "10:00" },  // Morning
    { start: "12:00", end: "14:00" },  // Noon
    { start: "16:00", end: "18:00" },  // Afternoon
    { start: "18:00", end: "20:00" },  // Evening
    { start: "20:00", end: "22:00" },  // Night
  ]),
  // v7: Quiet hours — no posts during this period.
  quietHours: quietHoursSchema.default({ start: "00:00", end: "07:30" }),
  // v7: Distributed lock timeout (seconds). Was hardcoded to 90.
  lockTimeoutSec: z.number().int().min(30).max(300).default(90),
  // v7: Minimum gap between posts (minutes). Was hardcoded to 90.
  minGapMinutes: z.number().int().min(15).max(480).default(90),
  // v7: Publishing mode.
  publishingMode: z.enum(["auto", "manual", "scheduled"]).default("auto"),
  burstPosting: z.boolean().default(false),
  skipIfLowQuality: z.boolean().default(true),
  refreshIntervalMinutes: z.number().int().min(5).max(1440).default(120),
});

export type SchedulerConfig = z.infer<typeof schedulerSchema>;

export const schedulerDefaults: SchedulerConfig = {
  _version: 2,
  enabled: true,
  slots: ["09:00", "13:00", "18:00", "22:00"],
  jitterMinutes: 30,
  timezone: "Asia/Tehran",
  postingWindows: [
    { start: "08:00", end: "10:00" },  // Morning
    { start: "12:00", end: "14:00" },  // Noon
    { start: "16:00", end: "18:00" },  // Afternoon
    { start: "18:00", end: "20:00" },  // Evening
    { start: "20:00", end: "22:00" },  // Night
  ],
  quietHours: { start: "00:00", end: "07:30" },
  lockTimeoutSec: 90,
  minGapMinutes: 90,
  publishingMode: "auto",
  burstPosting: false,
  skipIfLowQuality: true,
  refreshIntervalMinutes: 120,
};

export const schedulerSection = {
  key: "scheduler",
  version: 2,
  schema: schedulerSchema,
  defaults: schedulerDefaults,
  description:
    "Posting windows, quiet hours, lock timeout, min gap, publishing mode, refresh interval — all runtime-configurable.",
};

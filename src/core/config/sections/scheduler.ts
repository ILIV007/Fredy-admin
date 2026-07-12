/**
 * src/core/config/sections/scheduler.ts
 */
import { z } from "zod";

export const timeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const schedulerSchema = z.object({
  _version: z.literal(1),
  enabled: z.boolean(),
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(20),
  jitterMinutes: z.number().int().min(0).max(120),
  timezone: z.string().min(1),
  postingWindows: z.array(timeWindowSchema).default([]),
  burstPosting: z.boolean().default(false),
  skipIfLowQuality: z.boolean().default(true),
  tickLockTimeout: z.number().int().min(30).max(300).default(90),
  refreshIntervalMinutes: z.number().int().min(5).max(120).default(15),
  minGapMinutes: z.number().int().min(5).max(120).default(30),
});

export type SchedulerConfig = z.infer<typeof schedulerSchema>;

export const schedulerDefaults: SchedulerConfig = {
  _version: 1,
  enabled: false,
  slots: ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "23:00"],
  jitterMinutes: 25,
  timezone: "Asia/Tehran",
  postingWindows: [{ start: "08:00", end: "23:59" }],
  burstPosting: false,
  skipIfLowQuality: true,
  tickLockTimeout: 90,
  refreshIntervalMinutes: 15,
  minGapMinutes: 30,
};

export const schedulerSection = {
  key: "scheduler",
  version: 1,
  schema: schedulerSchema,
  defaults: schedulerDefaults,
  description: "Daily posting slots, jitter, timezone, windows, tick lock, refresh interval.",
};

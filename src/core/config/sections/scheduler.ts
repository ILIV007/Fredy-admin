/**
 * src/core/config/sections/scheduler.ts
 * Slot-based scheduler configuration. See FREDY_GUIDELINES.md §1.
 */

import { z } from "zod";

export const timeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const schedulerSchema = z.object({
  _version: z.literal(1),
  enabled: z.boolean(),
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(12),
  jitterMinutes: z.number().int().min(0).max(120),
  timezone: z.string().min(1),
  postingWindows: z.array(timeWindowSchema).default([]),
  burstPosting: z.boolean().default(false),
  skipIfLowQuality: z.boolean().default(true),
});

export type SchedulerConfig = z.infer<typeof schedulerSchema>;

export const schedulerDefaults: SchedulerConfig = {
  _version: 1,
  enabled: false,
  slots: ["09:00", "13:00", "18:00", "22:00"],
  jitterMinutes: 30,
  timezone: "Asia/Tehran",
  postingWindows: [],
  burstPosting: false,
  skipIfLowQuality: true,
};

export const schedulerSection = {
  key: "scheduler",
  version: 1,
  schema: schedulerSchema,
  defaults: schedulerDefaults,
  description:
    "Daily posting slots, random jitter, timezone, allowed posting windows, and burst mode.",
};

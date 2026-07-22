/**
 * src/core/config/sections/tier-v.ts
 * v12.0.9 — Tier V Scheduled Content configuration.
 *
 * Tier V is for fixed-schedule content (NASA APOD, weekly reports, etc).
 * Unlike normal tiers (S/A/B/Legacy), Tier V does NOT use:
 *   - Random jitter
 *   - Normal provider queue
 *   - Category slots
 *
 * Each Tier V entry has a fixed schedule (daily at a specific time).
 * The scheduler checks Tier V entries alongside normal window slots.
 */

import { z } from "zod";

export const tierVEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Fixed publish time in HH:MM format (timezone-aware). */
  time: z.string().regex(/^\d{2}:\d{2}$/).default("22:30"),
  /** Provider ID to fetch content from (must be a registered plugin). */
  providerId: z.string().min(1),
  /** Category label for history/display (not used for scheduling). */
  category: z.string().default("V"),
  /** Description for the admin UI. */
  description: z.string().default(""),
});

export type TierVEntry = z.infer<typeof tierVEntrySchema>;

export const tierVSchema = z.object({
  _version: z.literal(1),
  entries: z.array(tierVEntrySchema).default([
    {
      id: "nasa-apod",
      enabled: true,
      time: "22:30",
      providerId: "nasa",
      category: "V",
      description: "NASA Astronomy Picture of the Day — nightly at 22:30",
    },
  ]),
});

export type TierVConfig = z.infer<typeof tierVSchema>;

export const tierVDefaults: TierVConfig = {
  _version: 1,
  entries: [
    {
      id: "nasa-apod",
      enabled: true,
      time: "22:30",
      providerId: "nasa",
      category: "V",
      description: "NASA Astronomy Picture of the Day — nightly at 22:30",
    },
  ],
};

export const tierVSection = {
  key: "tierV",
  version: 1,
  schema: tierVSchema,
  defaults: tierVDefaults,
  description: "Tier V: fixed-schedule content (NASA APOD, weekly reports, etc).",
};

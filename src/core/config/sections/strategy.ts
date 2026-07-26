/**
 * src/core/config/sections/strategy.ts
 * Strategy Engine runtime configuration.
 *
 * All settings are loaded from KV and take effect on the next plan
 * generation — no redeployment required.
 */

import { z } from "zod";

export const strategyConfigSchema = z.object({
  _version: z.literal(1),
  /** Active strategy mode. v13.0.0: added conservative, aggressive, turbo. */
  mode: z.enum([
    "minimal",
    "balanced",
    "active",
    "ai_priority",
    "news_priority",
    "custom",
    "conservative",
    "aggressive",
    "turbo",
  ]).default("balanced"),
  /** Custom distribution (only used when mode = "custom"). */
  customDistribution: z.object({
    A: z.number().int().min(0).max(20),
    B: z.number().int().min(0).max(20),
    C: z.number().int().min(0).max(20),
    H: z.number().int().min(0).max(20).default(1),
  }).default({ A: 4, B: 2, C: 3, H: 1 }),
  /** Whether weekly themes are enabled. */
  weeklyThemesEnabled: z.boolean().default(true),
  /** Language for planned posts. */
  language: z.enum(["fa", "en", "auto"]).default("auto"),
  /** Quality threshold override (for ai_priority). */
  qualityThreshold: z.number().int().min(0).max(100).default(80),
  /** v13.0.0: Tier H (Hardware & Technology Headlines) configuration.
   *  These values are FULLY CONFIGURABLE — change from Manager without redeploy.
   *  Per-mode extra H posts/day. Conservative=0, balanced=1, active=2,
   *  aggressive=3, turbo=4 by default (per user spec). */
  tierH: z.object({
    enabled: z.boolean().default(true),
    extraHPostsPerMode: z.object({
      minimal: z.number().int().min(0).max(10).default(0),
      conservative: z.number().int().min(0).max(10).default(0),
      balanced: z.number().int().min(0).max(10).default(1),
      active: z.number().int().min(0).max(10).default(2),
      ai_priority: z.number().int().min(0).max(10).default(1),
      news_priority: z.number().int().min(0).max(10).default(2),
      aggressive: z.number().int().min(0).max(10).default(3),
      turbo: z.number().int().min(0).max(10).default(4),
      custom: z.number().int().min(0).max(10).default(1),
    }).default({}),
    /** Conservative mode: publish H every N days (1 = daily, 2 = every 2 days). */
    conservativeIntervalDays: z.number().int().min(1).max(7).default(2),
    /** Provider cooldown in minutes (avoid immediate repetition). */
    providerCooldownMinutes: z.number().int().min(0).max(1440).default(60),
    /** Max repeats per provider per day (same as MAX_PROVIDER_REPEAT for A/B/C). */
    maxProviderRepeat: z.number().int().min(1).max(10).default(2),
    /** Retry count before marking H slot as failed. */
    retryCount: z.number().int().min(0).max(5).default(2),
    /** RSS fetch timeout in milliseconds. */
    fetchTimeoutMs: z.number().int().min(1000).max(30000).default(8000),
  }).default({}),
});

export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

export const strategyDefaults: StrategyConfig = {
  _version: 1,
  mode: "balanced",
  customDistribution: { A: 4, B: 2, C: 3, H: 1 },
  weeklyThemesEnabled: true,
  language: "auto",
  qualityThreshold: 80,
  tierH: {
    enabled: true,
    extraHPostsPerMode: {
      minimal: 0,
      conservative: 0,
      balanced: 1,
      active: 2,
      ai_priority: 1,
      news_priority: 2,
      aggressive: 3,
      turbo: 4,
      custom: 1,
    },
    conservativeIntervalDays: 2,
    providerCooldownMinutes: 60,
    maxProviderRepeat: 2,
    retryCount: 2,
    fetchTimeoutMs: 8000,
  },
};

export const strategySection = {
  key: "strategy",
  version: 1,
  schema: strategyConfigSchema,
  defaults: strategyDefaults,
  description:
    "Publishing strategy mode, custom distribution, weekly themes, language, and quality threshold.",
};

// ────────────────────────────────────────────────────────────
// Built-in Strategy Definitions
// ────────────────────────────────────────────────────────────

import type { StrategyDefinition } from "../../../types/strategy";

export const BUILTIN_STRATEGIES: Readonly<Record<string, StrategyDefinition>> = {
  minimal: {
    mode: "minimal",
    name: "Minimal",
    description: "Low activity — 4 posts/day",
    distribution: { A: 2, B: 1, C: 1, total: 4, H: 0 },
  },
  conservative: {
    mode: "conservative",
    name: "Conservative",
    description: "v13.0.0: 9 posts/day + 1 Tier H every 2 days (configurable)",
    distribution: { A: 4, B: 2, C: 3, total: 9, H: 0 }, // H=0 base; interval logic adds H every N days
  },
  balanced: {
    mode: "balanced",
    name: "Balanced",
    description: "Normal operation — 9 posts/day + 1 Tier H (v13.0.0)",
    distribution: { A: 4, B: 2, C: 3, total: 9, H: 1 },
  },
  active: {
    mode: "active",
    name: "Active",
    description: "High activity — 13 posts/day + 2 Tier H (v13.0.0)",
    distribution: { A: 6, B: 3, C: 4, total: 13, H: 2 },
  },
  aggressive: {
    mode: "aggressive",
    name: "Aggressive",
    description: "v13.0.0: 13 posts/day + 3 Tier H",
    distribution: { A: 6, B: 3, C: 4, total: 13, H: 3 },
  },
  turbo: {
    mode: "turbo",
    name: "Turbo",
    description: "v13.0.0: 13 posts/day + 4 Tier H (max hardware coverage)",
    distribution: { A: 6, B: 3, C: 4, total: 13, H: 4 },
  },
  ai_priority: {
    mode: "ai_priority",
    name: "AI Priority",
    description: "Maximum quality — 8 posts/day, threshold 80",
    distribution: { A: 5, B: 1, C: 2, total: 8, H: 1 },
    qualityOverride: { qualityThreshold: 80 },
  },
  news_priority: {
    mode: "news_priority",
    name: "News Priority",
    description: "Fast technology updates — 10 posts/day",
    distribution: { A: 3, B: 5, C: 2, total: 10, H: 2 },
  },
  custom: {
    mode: "custom",
    name: "Custom",
    description: "Administrator-defined distribution",
    distribution: { A: 4, B: 2, C: 3, total: 9, H: 1 }, // overridden at runtime
  },
};

// ────────────────────────────────────────────────────────────
// Weekly Themes
// ────────────────────────────────────────────────────────────

import type { WeeklyThemes } from "../../../types/strategy";

export const DEFAULT_WEEKLY_THEMES: WeeklyThemes = [
  // v12.3.0: Complete rewrite — each day has explicit preferredProviders.
  // Day 0 = Sunday (JS getDay()), 1 = Monday, ... 6 = Saturday.
  // Every day covers different APIs so all 15 active providers are used across the week.
  // Each day has 4-5 preferred providers; the scheduler picks from these first.
  {
    day: 6, dayName: "Saturday",
    topics: ["AI", "Open Source", "Innovation"],
    preferredProviders: ["huggingface-blog", "github-events", "devto", "openai-news"],
  },
  {
    day: 0, dayName: "Sunday",
    topics: ["Cloud", "Backend", "Infrastructure"],
    preferredProviders: ["cloudflare-blog", "github-releases", "stackexchange", "producthunt"],
  },
  {
    day: 1, dayName: "Monday",
    topics: ["Web Development", "Frameworks", "Tools"],
    preferredProviders: ["github", "github-trending", "devto", "hackernews-algolia"],
  },
  {
    day: 2, dayName: "Tuesday",
    topics: ["Open Source", "Community", "Discovery"],
    preferredProviders: ["github-events", "github-trending", "reddit-v2", "cloudflare-blog"],
  },
  {
    day: 3, dayName: "Wednesday",
    topics: ["Security", "Advisories", "Best Practices"],
    preferredProviders: ["github-security", "github-releases", "stackexchange", "hackernews-algolia"],
  },
  {
    day: 4, dayName: "Thursday",
    topics: ["Developer Tools", "Products", "Innovation"],
    preferredProviders: ["producthunt", "huggingface-blog", "openai-news", "devto"],
  },
  {
    day: 5, dayName: "Friday",
    topics: ["Community", "Fun", "Space"],
    preferredProviders: ["xkcd", "github", "reddit-v2", "github-trending"],
  },
];

// ────────────────────────────────────────────────────────────
// Category → Provider mapping
// ────────────────────────────────────────────────────────────

export const CATEGORY_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  // v11.1.0: Updated with all 20 providers (active + legacy).
  A: [
    "github",
    "github-trending",
    "github-releases",
    "github-events",
    "github-security",
    "devto",
    "stackexchange",
    "huggingface-blog",
    "reddit-v2",
    // Legacy:
    "reddit",
  ],
  B: [
    "hackernews-algolia",
    "cloudflare-blog",
    "producthunt",
    "openai-news",
    // Legacy:
    "news",
    "hackernews",
  ],
  C: [
    "xkcd",
    // Legacy:
    "wikimedia",
    "joke",
    // v12.0.9: NASA moved to Tier V (scheduled content) — no longer in Cat C rotation
  ],
  // v13.0.0: Category H — Hardware & Technology Headlines.
  // RSS-only providers. One RSS item = one Strategy candidate.
  // These are ADDITIVE to A/B/C — extra posts per day based on Strategy Mode.
  H: [
    "ars-technica",
    "toms-hardware",
    "techpowerup",
  ],
};

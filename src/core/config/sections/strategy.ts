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
  /** Active strategy mode. */
  mode: z.enum([
    "minimal",
    "balanced",
    "active",
    "ai_priority",
    "news_priority",
    "custom",
  ]).default("balanced"),
  /** Custom distribution (only used when mode = "custom"). */
  customDistribution: z.object({
    A: z.number().int().min(0).max(20),
    B: z.number().int().min(0).max(20),
    C: z.number().int().min(0).max(20),
  }).default({ A: 4, B: 2, C: 3 }),
  /** Whether weekly themes are enabled. */
  weeklyThemesEnabled: z.boolean().default(true),
  /** Language for planned posts. */
  language: z.enum(["fa", "en", "auto"]).default("auto"),
  /** Quality threshold override (for ai_priority). */
  qualityThreshold: z.number().int().min(0).max(100).default(80),
});

export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

export const strategyDefaults: StrategyConfig = {
  _version: 1,
  mode: "balanced",
  customDistribution: { A: 4, B: 2, C: 3 },
  weeklyThemesEnabled: true,
  language: "auto",
  qualityThreshold: 80,
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
    distribution: { A: 2, B: 1, C: 1, total: 4 },
  },
  balanced: {
    mode: "balanced",
    name: "Balanced",
    description: "Normal operation — 9 posts/day",
    distribution: { A: 4, B: 2, C: 3, total: 9 },
  },
  active: {
    mode: "active",
    name: "Active",
    description: "High activity — 13 posts/day",
    distribution: { A: 6, B: 3, C: 4, total: 13 },
  },
  ai_priority: {
    mode: "ai_priority",
    name: "AI Priority",
    description: "Maximum quality — 8 posts/day, threshold 80",
    distribution: { A: 5, B: 1, C: 2, total: 8 },
    qualityOverride: { qualityThreshold: 80 },
  },
  news_priority: {
    mode: "news_priority",
    name: "News Priority",
    description: "Fast technology updates — 10 posts/day",
    distribution: { A: 3, B: 5, C: 2, total: 10 },
  },
  custom: {
    mode: "custom",
    name: "Custom",
    description: "Administrator-defined distribution",
    distribution: { A: 4, B: 2, C: 3, total: 9 }, // overridden at runtime
  },
};

// ────────────────────────────────────────────────────────────
// Weekly Themes
// ────────────────────────────────────────────────────────────

import type { WeeklyThemes } from "../../../types/strategy";

export const DEFAULT_WEEKLY_THEMES: WeeklyThemes = [
  // v11.1.0: Updated weekly themes per refactor spec.
  // Day 0 = Sunday (JS getDay()), 1 = Monday, ... 6 = Saturday.
  { day: 6, dayName: "Saturday",  topics: ["AI", "Open Source", "Hugging Face", "GitHub"] },
  { day: 0, dayName: "Sunday",    topics: ["Cloud", "Backend", "Cloudflare", "DevOps"] },
  { day: 1, dayName: "Monday",    topics: ["Web Development", "Frameworks", "React", "Next.js"] },
  { day: 2, dayName: "Tuesday",   topics: ["Open Source", "GitHub", "Community"] },
  { day: 3, dayName: "Wednesday", topics: ["Security", "Advisories", "GitHub Security"] },
  { day: 4, dayName: "Thursday",  topics: ["Developer Tools", "Product Hunt", "Dev.to"] },
  { day: 5, dayName: "Friday",    topics: ["Community", "Space", "NASA", "XKCD"] },
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
    "nasa",
    "xkcd",
    // Legacy:
    "wikimedia",
    "joke",
  ],
};

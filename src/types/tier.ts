/**
 * src/types/tier.ts
 * Provider Tier system (v11+).
 *
 * Tiers determine SCHEDULING PRIORITY (how often a provider is refreshed).
 * Categories (src/types/category.ts) remain for CONTENT CLASSIFICATION only.
 *
 * Architecture change (v11):
 *   Before: Scheduler works with Categories (A/B/C) → picks provider by category.
 *   After:  Scheduler works with Tiers (S/A/B/Legacy) → refreshes by tier interval.
 *           Categories stay for content type labeling (Programming, AI, Space...).
 *
 * See PROJECT_STATUS_REPORT.md §15 and the v11 Phase 1 spec.
 */

/**
 * Provider tiers, in priority order.
 * - S     : Core providers. Refreshed every 2 hours. Always enabled by default.
 * - A     : Important providers. Refreshed every 6 hours. Enabled by default.
 * - B     : Supporting providers. Refreshed every 12 hours. Enabled by default.
 * - Legacy: Old providers. Refreshed every 24 hours. Disabled by default.
 * - V     : v12.0.9 Scheduled/manual content. Fixed schedule, no jitter, no
 *           provider queue. Examples: NASA APOD (nightly 22:30), weekly reports.
 *           Tier V providers are NOT refreshed by Layer 2 — they fetch on demand.
 */
export type Tier = "S" | "A" | "B" | "legacy" | "V";

/** Ordered list of tiers (highest priority first). */
export const TIER_ORDER: readonly Tier[] = ["S", "A", "B", "legacy", "V"] as const;

/** All valid tier values (for runtime validation). */
export const TIER_VALUES = ["S", "A", "B", "legacy", "V"] as const;

/**
 * Default refresh interval (in hours) for each tier.
 * Source of truth is src/core/constants.ts; this is a convenience mapping.
 * v12.0.9: Tier V = 0 (fetch on demand, not on a refresh interval).
 */
export const TIER_DEFAULT_REFRESH_HOURS: Readonly<Record<Tier, number>> = {
  S: 2,
  A: 6,
  B: 12,
  legacy: 24,
  V: 0,
} as const;

/**
 * Whether a tier is enabled by default when a provider is first registered.
 * Legacy providers are disabled by default; all others are enabled.
 */
export const TIER_DEFAULT_ENABLED: Readonly<Record<Tier, boolean>> = {
  S: true,
  A: true,
  B: true,
  legacy: false,
  V: true,
} as const;

/** Convert a tier to a numeric priority for sorting (lower = higher priority). */
export function tierPriority(tier: Tier): number {
  switch (tier) {
    case "S": return 0;
    case "A": return 1;
    case "B": return 2;
    case "legacy": return 3;
    case "V": return 4;
  }
}

/** Whether a tier value is valid. */
export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIER_VALUES as readonly string[]).includes(value);
}

/** Compare two tiers for sorting (highest priority first). */
export function compareTiers(a: Tier, b: Tier): number {
  return tierPriority(a) - tierPriority(b);
}

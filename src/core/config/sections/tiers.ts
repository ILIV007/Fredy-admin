/**
 * src/core/config/sections/tiers.ts
 * Provider Tier configuration (v11+).
 *
 * Replaces the Category-based scheduling model with Tier-based scheduling.
 * Each provider can be individually configured at runtime:
 *   - refresh interval (hours)
 *   - enabled
 *   - tier assignment (S/A/B/legacy)
 *   - priority within tier
 *   - max items per fetch
 *   - min score threshold
 *   - timeout
 *   - retries
 *
 * See v11 Phase 1 spec and PROJECT_STATUS_REPORT.md §15.
 */

import { z } from "zod";
import { TIER_VALUES } from "../../../types/tier";

// ────────────────────────────────────────────────────────────
// Per-provider runtime config
// ────────────────────────────────────────────────────────────

/** Runtime configuration for a single provider (v11 Tier system). */
export const tierProviderConfigSchema = z.object({
  /** Whether this provider is enabled at runtime. */
  enabled: z.boolean(),
  /** Scheduling tier. Overrides manifest.tier if set. */
  tier: z.enum(TIER_VALUES as unknown as [string, ...string[]]),
  /** Priority within the tier (1 = highest). */
  priority: z.number().int().min(1).max(100),
  /** Refresh interval in hours. Overrides tier default if set. */
  refreshIntervalHours: z.number().int().min(1).max(168),
  /** Maximum items to accept per fetch. */
  maxItems: z.number().int().min(1).max(50),
  /** Minimum quality score (0-100) to accept an item. */
  minScore: z.number().int().min(0).max(100),
  /** Fetch timeout in milliseconds. */
  timeoutMs: z.number().int().min(1000).max(60_000),
  /** Number of retries on fetch failure. */
  retries: z.number().int().min(0).max(5),
});

export type TierProviderConfig = z.infer<typeof tierProviderConfigSchema>;

// ────────────────────────────────────────────────────────────
// Tier defaults
// ────────────────────────────────────────────────────────────

/** Default configuration values for each tier. */
export const tierDefaultsSchema = z.object({
  S: tierProviderConfigSchema,
  A: tierProviderConfigSchema,
  B: tierProviderConfigSchema,
  legacy: tierProviderConfigSchema,
});

export type TierDefaults = z.infer<typeof tierDefaultsSchema>;

// ────────────────────────────────────────────────────────────
// Full tiers config section
// ────────────────────────────────────────────────────────────

export const tiersSchema = z.object({
  _version: z.literal(1),

  /** Default config applied to each tier (providers inherit unless overridden). */
  tierDefaults: tierDefaultsSchema,

  /** Per-provider runtime overrides. Keyed by plugin ID. */
  providers: z.record(z.string(), tierProviderConfigSchema).default({}),

  /** Whether adaptive refresh is enabled (Phase 3). */
  adaptiveRefreshEnabled: z.boolean().default(true),

  /** Whether provider reputation scoring is enabled (Phase 3). */
  reputationScoringEnabled: z.boolean().default(true),

  /** Whether to batch provider refreshes (stagger) to avoid API spikes. */
  staggeredRefreshEnabled: z.boolean().default(true),
});

export type TiersConfig = z.infer<typeof tiersSchema>;

// ────────────────────────────────────────────────────────────
// Default values
// ────────────────────────────────────────────────────────────

/** Default per-tier configuration. */
export const tierDefaultsConfig: TierDefaults = {
  S: {
    enabled: true,
    tier: "S",
    priority: 1,
    refreshIntervalHours: 2,
    maxItems: 10,
    minScore: 50,
    timeoutMs: 15_000,
    retries: 1,
  },
  A: {
    enabled: true,
    tier: "A",
    priority: 1,
    refreshIntervalHours: 6,
    maxItems: 8,
    minScore: 45,
    timeoutMs: 15_000,
    retries: 1,
  },
  B: {
    enabled: true,
    tier: "B",
    priority: 1,
    refreshIntervalHours: 12,
    maxItems: 5,
    minScore: 40,
    timeoutMs: 15_000,
    retries: 1,
  },
  legacy: {
    enabled: false,
    tier: "legacy",
    priority: 1,
    refreshIntervalHours: 24,
    maxItems: 3,
    minScore: 30,
    timeoutMs: 15_000,
    retries: 0,
  },
};

export const tiersDefaults: TiersConfig = {
  _version: 1,
  tierDefaults: tierDefaultsConfig,
  providers: {} as Record<string, TierProviderConfig>,
  adaptiveRefreshEnabled: true,
  reputationScoringEnabled: true,
  staggeredRefreshEnabled: true,
};

// ────────────────────────────────────────────────────────────
// Section registration
// ────────────────────────────────────────────────────────────

export const tiersSection = {
  key: "tiers",
  version: 1,
  schema: tiersSchema,
  defaults: tiersDefaults,
  description:
    "Provider Tier configuration (v11). Per-provider runtime config for refresh interval, " +
    "enabled, tier, priority, max items, min score, timeout, and retries. " +
    "Replaces category-based scheduling.",
} as const;

/**
 * src/core/providers.config.ts
 * Central Provider Configuration — single source of truth for all provider metadata.
 *
 * v11.1.0: This file replaces scattered hardcoded values across:
 *   - candidate-ranker.ts CREDIBILITY_SCORES
 *   - popularity-filter.ts PLUGIN_MIN_STARS / PLUGIN_MIN_SCORE / EXEMPT_PLUGINS
 *   - constants.ts PROVIDER_REPUTATION_DEFAULTS
 *   - strategy.ts CATEGORY_PROVIDERS
 *
 * Adding a new provider now requires editing ONLY this file.
 * A structural test (scripts/test-plugin-registry.ts) asserts every plugin
 * registered in PluginManager has an entry here.
 *
 * See v11 Refactor Prompt — "Central Provider Config" proposal.
 */

import type { Tier } from "../types/tier";
import type { Category } from "../types/category";

// ────────────────────────────────────────────────────────────
// Provider Config Entry
// ────────────────────────────────────────────────────────────

/**
 * Complete metadata for a single provider.
 * Combines manifest-level info with runtime-configurable parameters.
 */
export interface ProviderConfigEntry {
  /** Unique plugin ID (must match manifest.ts id). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Scheduling tier. */
  readonly tier: Tier;
  /** Content category (classification only, not scheduling). */
  readonly category: Category;
  /** Provider weight for weighted-random selection (0-100, higher = more likely). */
  readonly weight: number;
  /** Default refresh interval in hours (overridable at runtime). */
  readonly refreshIntervalHours: number;
  /** Cache TTL in seconds for source fetch results. */
  readonly cacheTtlSeconds: number;
  /** Credibility score (0-100) for candidate ranking. */
  readonly credibility: number;
  /** Provider reputation score (0-100) for quality scoring. */
  readonly reputation: number;
  /** Rate limit in requests/hour (0 = unlimited). */
  readonly rateLimit: number;
  /** Whether this provider is enabled by default. */
  readonly enabledByDefault: boolean;
  /** Whether this provider supports images/media. */
  readonly supportsImages: boolean;
  /** Minimum stars threshold (for GitHub plugins, 0 = N/A). */
  readonly minStars: number;
  /** Minimum score/points threshold (for HN/SE/Dev.to, 0 = N/A). */
  readonly minScore: number;
  /** Whether this provider is exempt from popularity filtering. */
  readonly popularityExempt: boolean;
  /** Whether this provider can produce "breaking" content (critical advisories, major releases). */
  readonly canBreak: boolean;
  /** Homepage URL. */
  readonly homepage: string;
  /** API docs URL. */
  readonly docsUrl: string;
}

// ────────────────────────────────────────────────────────────
// Master Provider Table
// ────────────────────────────────────────────────────────────

/**
 * The single source of truth for all provider metadata.
 * To add a provider: add an entry here. That's it.
 * To remove: remove the entry (the plugin code stays in src/plugins/sources/ for compatibility).
 */
export const PROVIDERS_CONFIG: readonly ProviderConfigEntry[] = [
  // ════════════════════════════════════════════════════════════
  // Tier S — Core providers (refresh every 2h)
  // ════════════════════════════════════════════════════════════
  {
    id: "github-releases",
    name: "GitHub Releases",
    tier: "S",
    category: "A",
    weight: 100,
    refreshIntervalHours: 2,
    cacheTtlSeconds: 4 * 3600,
    credibility: 95,
    reputation: 100,
    rateLimit: 60,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 0, // releases are pre-curated
    minScore: 0,
    popularityExempt: false,
    canBreak: true, // major releases (e.g., React 19, Next.js 15)
    homepage: "https://github.com",
    docsUrl: "https://docs.github.com/en/rest/releases",
  },
  {
    id: "github-trending",
    name: "GitHub Trending",
    tier: "S",
    category: "A",
    weight: 88,
    refreshIntervalHours: 2,
    cacheTtlSeconds: 6 * 3600,
    credibility: 90,
    reputation: 90,
    rateLimit: 60,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 100,
    minScore: 0,
    popularityExempt: false,
    canBreak: false,
    homepage: "https://github.com",
    docsUrl: "https://docs.github.com/en/rest/search",
  },
  {
    id: "github",
    name: "GitHub Topic Search",
    tier: "S",
    category: "A",
    weight: 85,
    refreshIntervalHours: 2,
    cacheTtlSeconds: 4 * 3600,
    credibility: 95,
    reputation: 90,
    rateLimit: 60,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 100,
    minScore: 0,
    popularityExempt: false,
    canBreak: false,
    homepage: "https://github.com",
    docsUrl: "https://docs.github.com/en/rest/search",
  },
  {
    id: "github-events",
    name: "GitHub Events",
    tier: "S",
    category: "A",
    weight: 95,
    refreshIntervalHours: 2,
    cacheTtlSeconds: 2 * 3600,
    credibility: 92,
    reputation: 95,
    rateLimit: 60,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 500,
    minScore: 0,
    popularityExempt: false,
    canBreak: true, // release events
    homepage: "https://github.com",
    docsUrl: "https://docs.github.com/en/rest/activity/events",
  },
  {
    id: "devto",
    name: "Dev.to",
    tier: "S",
    category: "A",
    weight: 82,
    refreshIntervalHours: 2,
    cacheTtlSeconds: 2 * 3600,
    credibility: 75,
    reputation: 88,
    rateLimit: 1000,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 0,
    minScore: 50, // min 50 reactions
    popularityExempt: false,
    canBreak: false,
    homepage: "https://dev.to",
    docsUrl: "https://developers.forem.com/api",
  },
  {
    id: "hackernews-algolia",
    name: "Hacker News (Algolia)",
    tier: "S",
    category: "B",
    weight: 90,
    refreshIntervalHours: 2,
    cacheTtlSeconds: 2 * 3600,
    credibility: 90,
    reputation: 95,
    rateLimit: 0,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 120, // min 120 points
    popularityExempt: false,
    canBreak: true, // very high HN score (500+)
    homepage: "https://news.ycombinator.com",
    docsUrl: "https://hn.algolia.com/api",
  },
  {
    id: "nasa",
    name: "NASA APOD",
    tier: "S",
    category: "C",
    weight: 65,
    refreshIntervalHours: 6, // once daily is enough, but tier S for priority
    cacheTtlSeconds: 6 * 3600,
    credibility: 90,
    reputation: 80,
    rateLimit: 1000,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 0,
    minScore: 0,
    popularityExempt: true, // unique daily content
    canBreak: false,
    homepage: "https://apod.nasa.gov",
    docsUrl: "https://api.nasa.gov/",
  },

  // ════════════════════════════════════════════════════════════
  // Tier A — Important providers (refresh every 6h)
  // ════════════════════════════════════════════════════════════
  {
    id: "stackexchange",
    name: "Stack Exchange",
    tier: "A",
    category: "A",
    weight: 80,
    refreshIntervalHours: 6,
    cacheTtlSeconds: 24 * 3600,
    credibility: 85,
    reputation: 85,
    rateLimit: 300,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 10, // min 10 score
    popularityExempt: false,
    canBreak: false,
    homepage: "https://stackoverflow.com",
    docsUrl: "https://api.stackexchange.com",
  },
  {
    id: "cloudflare-blog",
    name: "Cloudflare Blog",
    tier: "A",
    category: "B",
    weight: 94,
    refreshIntervalHours: 6,
    cacheTtlSeconds: 6 * 3600,
    credibility: 95,
    reputation: 95,
    rateLimit: 0,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true, // RSS, no popularity metric
    canBreak: true, // major Cloudflare announcements
    homepage: "https://blog.cloudflare.com",
    docsUrl: "https://blog.cloudflare.com/rss/",
  },
  {
    id: "huggingface-blog",
    name: "Hugging Face Blog",
    tier: "A",
    category: "A",
    weight: 92,
    refreshIntervalHours: 6,
    cacheTtlSeconds: 6 * 3600,
    credibility: 93,
    reputation: 92,
    rateLimit: 0,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: true, // major model releases
    homepage: "https://huggingface.co/blog",
    docsUrl: "https://huggingface.co/blog/feed.xml",
  },
  {
    id: "producthunt",
    name: "Product Hunt",
    tier: "A",
    category: "B",
    weight: 84,
    refreshIntervalHours: 6,
    cacheTtlSeconds: 6 * 3600,
    credibility: 80,
    reputation: 85,
    rateLimit: 0,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 0,
    minScore: 0,
    popularityExempt: false,
    canBreak: false,
    homepage: "https://www.producthunt.com",
    docsUrl: "https://api.producthunt.com/",
  },

  // ════════════════════════════════════════════════════════════
  // Tier B — Supporting providers (refresh every 12h)
  // ════════════════════════════════════════════════════════════
  {
    id: "xkcd",
    name: "XKCD",
    tier: "B",
    category: "C",
    weight: 60,
    refreshIntervalHours: 12,
    cacheTtlSeconds: 3600,
    credibility: 60,
    reputation: 75,
    rateLimit: 0,
    enabledByDefault: true,
    supportsImages: true,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: false,
    homepage: "https://xkcd.com",
    docsUrl: "https://xkcd.com/json.html",
  },
  {
    id: "reddit-v2",
    name: "Reddit Programming",
    tier: "B",
    category: "A",
    weight: 70,
    refreshIntervalHours: 12,
    cacheTtlSeconds: 12 * 3600,
    credibility: 70,
    reputation: 70,
    rateLimit: 60,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 100, // min 100 upvotes
    popularityExempt: false,
    canBreak: false,
    homepage: "https://www.reddit.com/r/programming",
    docsUrl: "https://www.reddit.com/r/programming/.json",
  },
  {
    id: "github-security",
    name: "GitHub Security Advisories",
    tier: "B",
    category: "A",
    weight: 98,
    refreshIntervalHours: 12,
    cacheTtlSeconds: 12 * 3600,
    credibility: 95,
    reputation: 93,
    rateLimit: 60,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: true, // critical security advisories always break
    homepage: "https://github.com/advisories",
    docsUrl: "https://docs.github.com/en/rest/security-advisories",
  },
  {
    id: "openai-news",
    name: "OpenAI News",
    tier: "B",
    category: "B",
    weight: 88,
    refreshIntervalHours: 12,
    cacheTtlSeconds: 12 * 3600,
    credibility: 92,
    reputation: 90,
    rateLimit: 0,
    enabledByDefault: true,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: true, // major model releases (GPT-5, etc.)
    homepage: "https://openai.com/news",
    docsUrl: "https://openai.com/news/rss.xml",
  },

  // ════════════════════════════════════════════════════════════
  // Legacy providers (disabled by default, kept for compatibility)
  // ════════════════════════════════════════════════════════════
  {
    id: "hackernews",
    name: "Hacker News (Firebase, legacy)",
    tier: "legacy",
    category: "B",
    weight: 50,
    refreshIntervalHours: 24,
    cacheTtlSeconds: 30 * 60,
    credibility: 70,
    reputation: 60,
    rateLimit: 0,
    enabledByDefault: false,
    supportsImages: false,
    minStars: 0,
    minScore: 50,
    popularityExempt: false,
    canBreak: false,
    homepage: "https://news.ycombinator.com",
    docsUrl: "https://github.com/HackerNews/API",
  },
  {
    id: "news",
    name: "Tech News (NewsAPI, legacy)",
    tier: "legacy",
    category: "B",
    weight: 40,
    refreshIntervalHours: 24,
    cacheTtlSeconds: 3600,
    credibility: 65,
    reputation: 60,
    rateLimit: 100,
    enabledByDefault: false,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: false,
    homepage: "https://newsapi.org",
    docsUrl: "https://newsapi.org",
  },
  {
    id: "joke",
    name: "Dev Jokes (legacy)",
    tier: "legacy",
    category: "C",
    weight: 30,
    refreshIntervalHours: 24,
    cacheTtlSeconds: 30 * 60,
    credibility: 50,
    reputation: 50,
    rateLimit: 120,
    enabledByDefault: false,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: false,
    homepage: "https://v2.jokeapi.dev",
    docsUrl: "https://v2.jokeapi.dev",
  },
  {
    id: "wikimedia",
    name: "Today in Tech History (legacy)",
    tier: "legacy",
    category: "C",
    weight: 35,
    refreshIntervalHours: 24,
    cacheTtlSeconds: 6 * 3600,
    credibility: 70,
    reputation: 55,
    rateLimit: 200,
    enabledByDefault: false,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: false,
    homepage: "https://en.wikipedia.org",
    docsUrl: "https://en.wikipedia.org/api/rest_v1/",
  },
  {
    id: "reddit",
    name: "Reddit (legacy, needs OAuth)",
    tier: "legacy",
    category: "A",
    weight: 40,
    refreshIntervalHours: 24,
    cacheTtlSeconds: 3600,
    credibility: 65,
    reputation: 50,
    rateLimit: 60,
    enabledByDefault: false,
    supportsImages: false,
    minStars: 0,
    minScore: 0,
    popularityExempt: true,
    canBreak: false,
    homepage: "https://www.reddit.com",
    docsUrl: "https://www.reddit.com/dev/api",
  },
] as const;

// ────────────────────────────────────────────────────────────
// Lookup helpers (derived from PROVIDERS_CONFIG)
// ────────────────────────────────────────────────────────────

/** Quick lookup: provider ID → config entry. */
const PROVIDER_MAP: Readonly<Record<string, ProviderConfigEntry>> = Object.fromEntries(
  PROVIDERS_CONFIG.map((p) => [p.id, p]),
);

/** Get a provider config entry by ID. Returns undefined if not found. */
export function getProviderConfig(id: string): ProviderConfigEntry | undefined {
  return PROVIDER_MAP[id];
}

/** Get the credibility score for a provider (default 50 if unknown). */
export function getCredibilityScore(id: string): number {
  return PROVIDER_MAP[id]?.credibility ?? 50;
}

/** Get the reputation score for a provider (default 60 if unknown). */
export function getReputationScore(id: string): number {
  return PROVIDER_MAP[id]?.reputation ?? 60;
}

/** Get the weight for a provider (default 50 if unknown). */
export function getProviderWeight(id: string): number {
  return PROVIDER_MAP[id]?.weight ?? 50;
}

/** Get the min stars threshold for a provider (default 0 if unknown). */
export function getMinStars(id: string): number {
  return PROVIDER_MAP[id]?.minStars ?? 0;
}

/** Get the min score threshold for a provider (default 0 if unknown). */
export function getMinScore(id: string): number {
  return PROVIDER_MAP[id]?.minScore ?? 0;
}

/** Check if a provider is exempt from popularity filtering. */
export function isPopularityExempt(id: string): boolean {
  return PROVIDER_MAP[id]?.popularityExempt ?? false;
}

/** Check if a provider can produce breaking content. */
export function canProviderBreak(id: string): boolean {
  return PROVIDER_MAP[id]?.canBreak ?? false;
}

/** Get the refresh interval (hours) for a provider. */
export function getRefreshInterval(id: string): number {
  return PROVIDER_MAP[id]?.refreshIntervalHours ?? 24;
}

/** Get the cache TTL (seconds) for a provider. */
export function getCacheTtl(id: string): number {
  return PROVIDER_MAP[id]?.cacheTtlSeconds ?? 3600;
}

/** Get the rate limit (requests/hour) for a provider. */
export function getRateLimit(id: string): number {
  return PROVIDER_MAP[id]?.rateLimit ?? 0;
}

/** List all provider IDs. */
export function getAllProviderIds(): readonly string[] {
  return PROVIDERS_CONFIG.map((p) => p.id);
}

/** List provider IDs by tier. */
export function getProvidersByTier(tier: Tier): readonly string[] {
  return PROVIDERS_CONFIG.filter((p) => p.tier === tier).map((p) => p.id);
}

/** List provider IDs by category. */
export function getProvidersByCategory(category: Category): readonly string[] {
  return PROVIDERS_CONFIG.filter((p) => p.category === category).map((p) => p.id);
}

/** List enabled provider IDs by tier. */
export function getEnabledProvidersByTier(tier: Tier): readonly string[] {
  return PROVIDERS_CONFIG.filter((p) => p.tier === tier && p.enabledByDefault).map((p) => p.id);
}

/**
 * Weighted random selection of a provider from a list.
 * Higher weight = higher probability of selection.
 * Uses a simple weighted random algorithm.
 *
 * @param ids List of provider IDs to choose from.
 * @param excludeIds IDs to exclude (for rotation/anti-repeat).
 * @returns Selected provider ID, or null if none available.
 */
export function selectProviderWeighted(
  ids: readonly string[],
  excludeIds: readonly string[] = [],
): string | null {
  const excludeSet = new Set(excludeIds);
  const eligible = ids.filter((id) => !excludeSet.has(id));
  if (eligible.length === 0) return null;

  const weighted = eligible.map((id) => ({
    id,
    weight: Math.max(1, getProviderWeight(id)),
  }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

  let random = Math.random() * totalWeight;
  for (const w of weighted) {
    random -= w.weight;
    if (random <= 0) return w.id;
  }
  return weighted[weighted.length - 1]?.id ?? null;
}

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

/**
 * Assert that a provider ID has a config entry.
 * Used by the structural test to catch missing entries.
 */
export function assertProviderConfigured(id: string): boolean {
  return id in PROVIDER_MAP;
}

/** Get all provider IDs that are missing from the config (for diagnostics). */
export function findMissingProviders(registeredIds: readonly string[]): readonly string[] {
  return registeredIds.filter((id) => !(id in PROVIDER_MAP));
}

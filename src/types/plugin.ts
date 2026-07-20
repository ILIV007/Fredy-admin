/**
 * src/types/plugin.ts
 * Plugin contracts for content sources and AI providers.
 *
 * See ARCHITECTURE_RULES.md §5 (Plugin First).
 * Every external service is a plugin. Core never depends on a concrete plugin.
 */

import type { Category } from "./category";
import type { Tier } from "./tier";
import type { AICompleteRequest, AICompleteResponse } from "./ai";
import type { SourceItem } from "./api";
import type { Env } from "./env";

// ────────────────────────────────────────────────────────────
// Plugin Manifest (metadata)
// ────────────────────────────────────────────────────────────

/**
 * Static metadata about a plugin. Declared in each plugin's manifest.ts.
 * The PluginManager reads this to register, sort, and display the plugin.
 *
 * v11: Added `tier` field. Tiers determine SCHEDULING PRIORITY.
 *      `category` remains for CONTENT CLASSIFICATION only.
 */
export interface PluginManifest {
  /** Unique identifier. Used in KV keys, logs, admin panel. e.g., "github". */
  readonly id: string;

  /** Human-readable name. e.g., "GitHub Trending". */
  readonly name: string;

  /** Semantic version of the plugin itself. e.g., "1.0.0". */
  readonly version: string;

  /** Whether the plugin is enabled by default. Can be toggled at runtime. */
  readonly enabled: boolean;

  /**
   * Content category this plugin produces (for classification only).
   * v11: Categories are NO LONGER used for scheduling. Use `tier` for that.
   */
  readonly category: Category;

  /**
   * Scheduling tier (v11+). Determines refresh interval and priority.
   * - "S"      : Core, every 2h, always enabled
   * - "A"      : Important, every 6h, enabled
   * - "B"      : Supporting, every 12h, enabled
   * - "legacy" : Old providers, every 24h, disabled by default
   */
  readonly tier: Tier;

  /** Priority (1 = highest). Used when multiple plugins share the same tier. */
  readonly priority: number;

  /** Rate limit in requests per hour. 0 = unlimited. */
  readonly rateLimit: number;

  /** Whether this plugin can return image/media items (e.g., NASA). */
  readonly supportsImages: boolean;

  /** Human-readable description for the admin panel. */
  readonly description?: string;

  /** Author/credits. */
  readonly author?: string;

  /** URL to the upstream API docs. */
  readonly docsUrl?: string;

  /** Provider homepage (the upstream service URL, e.g., "https://github.com"). */
  readonly homepage?: string;

  /** Whether this provider supports markdown content. */
  readonly supportsMarkdown?: boolean;

  /** Languages this provider supports (e.g., ["en"] for English-only sources). */
  readonly supportsLanguage?: readonly string[];

  // ─── v11.6.0: Provider Display Metadata ───
  // These fields control how the provider appears in the post footer.
  // The formatter NEVER guesses — it renders exactly what the provider supplies.
  // If both are empty, the footer falls back to "🌌 Source".

  /** Icon emoji for the footer (e.g., "☁️", "🤗", "✨", "🐙"). */
  readonly displayIcon?: string;

  /**
   * Display label for the footer (e.g., "Cloudflare Blog", "Hugging Face").
   * For GitHub providers, set to null — the formatter extracts "owner/repo" from the URL.
   * If empty/null and not a GitHub URL, falls back to "Source".
   */
  readonly displaySource?: string | null;

  /**
   * Whether this provider's displaySource should be extracted from the URL
   * (GitHub repos: "owner/repo"). When true, the normalize() method extracts
   * the repo name from the source URL.
   */
  readonly extractRepoFromUrl?: boolean;
}

// ────────────────────────────────────────────────────────────
// Plugin Status (runtime state)
// ────────────────────────────────────────────────────────────

/**
 * Runtime status of a plugin. Updated after every fetch and health check.
 * Stored in KV at `fredy:plugin:<id>:status`.
 *
 * v11: Added fields for provider analytics (Phase 3):
 *   - itemsAccepted / itemsRejected (quality filter pass rate)
 *   - averageLatencyMs
 *   - currentBackoffMultiplier (adaptive refresh)
 *   - consecutiveEmptyFetches (adaptive refresh trigger)
 */
export interface PluginStatus {
  readonly pluginId: string;

  /** Whether the plugin is currently healthy (last fetch succeeded). */
  readonly healthy: boolean;

  /** Whether the plugin is currently enabled (runtime toggle). */
  readonly enabled: boolean;

  readonly lastFetchAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastErrorAt: number | null;
  readonly lastErrorMessage: string | null;

  readonly consecutiveFailures: number;
  readonly totalFetches: number;
  readonly totalSuccesses: number;
  readonly totalFailures: number;

  /** Remaining API calls in the current rate-limit window (if known). */
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetAt: number | null;

  /** Items returned in the last successful fetch. */
  readonly lastItemCount: number | null;

  // ─── v11 Phase 3: Provider Analytics ───

  /** Items that PASSED the per-provider quality filter (v11 Phase 2). */
  readonly itemsAccepted: number;

  /** Items that FAILED the per-provider quality filter. */
  readonly itemsRejected: number;

  /** Rolling average latency in milliseconds across recent fetches. */
  readonly averageLatencyMs: number | null;

  /** Consecutive fetches returning zero useful items (triggers adaptive backoff). */
  readonly consecutiveEmptyFetches: number;

  /** Current adaptive backoff multiplier (1 = normal, up to 4 = max backoff). */
  readonly currentBackoffMultiplier: number;

  /** Last time the provider's cache was refreshed (epoch ms). */
  readonly lastRefreshAt: number | null;
}

// ────────────────────────────────────────────────────────────
// Content Source Plugin Interface
// ────────────────────────────────────────────────────────────

/**
 * A content source plugin. Each external API (GitHub, News, NASA, Joke)
 * implements this interface.
 *
 * v11: Added `getTier()` and optional `qualityFilter()`.
 *
 * Every plugin MUST expose:
 *   - fetch()           — pull raw items from the upstream API
 *   - normalize(raw)    — convert a raw API response into a SourceItem
 *   - validate(item)    — check if a SourceItem is valid and publishable
 *   - supportsMedia()   — whether this plugin returns image/video items
 *   - getSource()       — return the plugin's source identifier
 *   - getCategory()     — return the category this plugin feeds (classification)
 *   - getTier()         — return the scheduling tier (v11)
 *   - qualityFilter()   — per-provider quality filter (v11 Phase 2)
 */
export interface Plugin {
  /** Static metadata. Declared once in the plugin's manifest. */
  readonly metadata: PluginManifest;

  /** Pull raw items from the upstream API. Returns empty array on failure. */
  fetch(): Promise<readonly SourceItem[]>;

  /** Convert a raw API response object into a normalized SourceItem. */
  normalize(raw: unknown): SourceItem;

  /** Validate that a SourceItem is well-formed and publishable. */
  validate(item: SourceItem): boolean;

  /** Whether this plugin returns image/video items (affects formatting). */
  supportsMedia(): boolean;

  /** Return the plugin's source identifier (same as metadata.id). */
  getSource(): string;

  /** Return the category this plugin feeds (same as metadata.category). */
  getCategory(): Category;

  /** Return the scheduling tier (v11, same as metadata.tier). */
  getTier(): Tier;

  /**
   * Per-provider quality filter (v11 Phase 2).
   * Runs BEFORE the item enters the pipeline, BEFORE AI, BEFORE ranking.
   * Returns the item with an optional quality score, or null if rejected.
   * Default implementation (if not overridden): accepts everything.
   */
  qualityFilter?(item: SourceItem): Promise<ProviderQualityResult | null>;

  /** Health check — return current status without fetching new items. */
  health(): Promise<PluginStatus>;
}

// ────────────────────────────────────────────────────────────
// Provider Quality Result (v11 Phase 2)
// ────────────────────────────────────────────────────────────

/**
 * Result of a per-provider quality filter check.
 * Returned by Plugin.qualityFilter().
 */
export interface ProviderQualityResult {
  /** The (possibly enriched) source item that passed the filter. */
  readonly item: SourceItem;

  /** Provider-specific quality score (0-100). Higher = better. */
  readonly score: number;

  /** Human-readable reason for the score (for debugging/dashboard). */
  readonly reason?: string;

  /** Whether this item should be boosted in ranking (e.g., trending). */
  readonly boost?: boolean;
}

// ────────────────────────────────────────────────────────────
// AI Provider Plugin Interface
// ────────────────────────────────────────────────────────────

/**
 * An AI provider plugin. GeminiProvider and OpenRouterProvider implement this.
 * The ProviderRegistry manages these separately from content source plugins.
 */
export interface AIProvider {
  /** Unique identifier (e.g., "gemini", "openrouter"). */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  /** Models this provider offers, in priority order. */
  readonly models: readonly string[];

  /** Whether the provider is configured (has API key in env). */
  isConfigured(env: Env): boolean;

  /** Send a completion request. Must respect the AbortSignal. */
  complete(
    request: AICompleteRequest,
    signal: AbortSignal,
  ): Promise<AICompleteResponse>;
}

// ────────────────────────────────────────────────────────────
// Quality Check Plugin Interface
// ────────────────────────────────────────────────────────────

/** A single quality check. Multiple checks compose into the QualityFilter. */
export interface QualityCheck {
  readonly name: string;
  readonly weight: number;
  check(post: import("./post").Post, context: QualityCheckContext): Promise<QualityCheckResult>;
}

export interface QualityCheckContext {
  readonly recentHashes: readonly string[];
  readonly requestedLanguage: string;
  readonly inputLinkCount: number;
  readonly outputLinkCount: number;
}

export interface QualityCheckResult {
  readonly passed: boolean;
  readonly score: number;
  readonly reason?: string;
}

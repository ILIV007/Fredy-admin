/**
 * src/types/plugin.ts
 * Plugin contracts for content sources and AI providers.
 *
 * See ARCHITECTURE_RULES.md §5 (Plugin First).
 * Every external service is a plugin. Core never depends on a concrete plugin.
 */

import type { Category } from "./category";
import type { AICompleteRequest, AICompleteResponse } from "./ai";
import type { FormatInput, FormatResult } from "../services/formatter";
import type { SourceItem } from "./api";
import type { Env } from "./env";

// ────────────────────────────────────────────────────────────
// Plugin Manifest (metadata)
// ────────────────────────────────────────────────────────────

/**
 * Static metadata about a plugin. Declared in each plugin's manifest.ts.
 * The PluginManager reads this to register, sort, and display the plugin.
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

  /** Which category this plugin feeds. */
  readonly category: Category;

  /** Priority (1 = highest). Used when multiple plugins serve the same category. */
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
}

// ────────────────────────────────────────────────────────────
// Plugin Status (runtime state)
// ────────────────────────────────────────────────────────────

/**
 * Runtime status of a plugin. Updated after every fetch and health check.
 * Stored in KV at `fredy:plugin:<id>:status`.
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
}

// ────────────────────────────────────────────────────────────
// Content Source Plugin Interface
// ────────────────────────────────────────────────────────────

/**
 * A content source plugin. Each external API (GitHub, News, NASA, Joke)
 * implements this interface.
 *
 * Every plugin MUST expose:
 *   - fetch()         — pull raw items from the upstream API
 *   - normalize(raw)  — convert a raw API response into a SourceItem
 *   - validate(item)  — check if a SourceItem is valid and publishable
 *   - supportsMedia() — whether this plugin returns image/video items
 *   - getSource()     — return the plugin's source identifier
 *   - getCategory()   — return the category this plugin feeds
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

  /** Health check — return current status without fetching new items. */
  health(): Promise<PluginStatus>;
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
// Formatter Plugin Interface
// ────────────────────────────────────────────────────────────

/** A formatter plugin. Converts AI output into Telegram-ready HTML. */
export interface Formatter {
  readonly name: string;
  format(input: FormatInput): FormatResult;
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

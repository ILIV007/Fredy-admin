/**
 * src/core/constants.ts
 * Protocol and mathematical constants. NOT runtime config — those live in KV.
 * See ARCHITECTURE_RULES.md §8.5.
 */

/** Application version — single source of truth.
 *  Bump together with VERSION file and CHANGELOG.md entry.
 *  All "version" strings in API responses should read from here, not be
 *  hardcoded inline (otherwise they drift, like the v6.2.0 strings did). */
export const APP_VERSION = "12.0.11" as const;

/** Build date — bump with each release. */
export const APP_BUILD_DATE = "2026-07-20" as const;

/** Telegram Bot API base URL. */
export const TELEGRAM_API_BASE = "https://api.telegram.org/bot" as const;

/** Telegram message length limits (hard protocol limits). */
export const TELEGRAM_TEXT_LIMIT = 4096 as const;
export const TELEGRAM_CAPTION_LIMIT = 1024 as const;

/** Time constants (mathematical truths). */
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Default timeout for external fetch calls (AI, sources). */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000 as const;

/** Pipeline overall timeout. */
export const PIPELINE_TIMEOUT_MS = 90_000 as const;

/** Max retries before an item goes to the dead-letter queue. */
export const MAX_RETRY_COUNT = 3 as const;

/** Batched stats flush threshold (reduces KV writes). Inherited from AI Admin. */
export const STATS_BATCH_FLUSH_THRESHOLD = 10 as const;

/** Debug ring buffer capacity. */
export const DEBUG_RING_BUFFER_CAPACITY = 30 as const;

/** Dedup hash length (SHA-1 first 200 chars normalized). */
export const DEDUP_HASH_INPUT_LENGTH = 200 as const;

/** Source emoji rotation pool. See FREDY_GUIDELINES.md §5.2. */
export const SOURCE_EMOJI_POOL = [
  "🌌", "🚀", "🤖", "📦", "⚡", "💡", "📚", "🛠️", "🌐", "🔒",
  "🎯", "🧩", "📝", "📊", "🔗", "🔧", "✨", "🐞", "📥", "🪐",
] as const;

/** Schema version. Must match src/types/config.ts. */
export const SETTINGS_SCHEMA_VERSION = 1 as const;

// ────────────────────────────────────────────────────────────
// Provider Tier System (v11+)
// ────────────────────────────────────────────────────────────
// Tiers determine SCHEDULING PRIORITY (how often a provider is refreshed).
// Categories remain for CONTENT CLASSIFICATION only (Programming, AI, Space...).
// See PROJECT_STATUS_REPORT.md §15 (v11 Compatibility Notes).

/** Default refresh interval for Tier S providers (core, every 2 hours). */
export const TIER_S_REFRESH_HOURS = 2 as const;
/** Default refresh interval for Tier A providers (important, every 6 hours). */
export const TIER_A_REFRESH_HOURS = 6 as const;
/** Default refresh interval for Tier B providers (supporting, every 12 hours). */
export const TIER_B_REFRESH_HOURS = 12 as const;
/** Default refresh interval for Legacy providers (every 24 hours). */
export const TIER_LEGACY_REFRESH_HOURS = 24 as const;

/**
 * Default provider reputation scores.
 * v11.1.0: Moved to src/core/providers.config.ts (single source of truth).
 * Use getReputationScore(id) from providers.config.ts instead.
 * This map is kept empty for backward compat — do not add entries here.
 * @deprecated Use getReputationScore() from src/core/providers.config.ts
 */
export const PROVIDER_REPUTATION_DEFAULTS: Readonly<Record<string, number>> = {};

/** Adaptive refresh: how many consecutive empty/low-quality fetches before backing off. */
export const ADAPTIVE_REFRESH_EMPTY_THRESHOLD = 3 as const;
/** Adaptive refresh multiplier when backing off (v11.1.0: linear +1 per step, not exponential). */
export const ADAPTIVE_REFRESH_BACKOFF_MULTIPLIER = 1 as const;
/** Adaptive refresh: max backoff multiplier cap (v11.1.0: 3x = 2h→4h→6h for Tier S). */
export const ADAPTIVE_REFRESH_MAX_BACKOFF = 3 as const;

/** Provider health ring buffer capacity (for analytics dashboard). */
export const PROVIDER_HEALTH_HISTORY_CAPACITY = 50 as const;

/**
 * src/core/constants.ts
 * Protocol and mathematical constants. NOT runtime config — those live in KV.
 * See ARCHITECTURE_RULES.md §8.5.
 */

/** Application version — single source of truth.
 *  Bump together with VERSION file and CHANGELOG.md entry.
 *  All "version" strings in API responses should read from here, not be
 *  hardcoded inline (otherwise they drift, like the v6.2.0 strings did). */
export const APP_VERSION = "8.7.0" as const;

/** Build date — bump with each release. */
export const APP_BUILD_DATE = "2026-07-15" as const;

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

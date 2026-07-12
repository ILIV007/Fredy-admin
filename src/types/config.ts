/**
 * src/types/config.ts
 * Runtime configuration types — section-based architecture.
 *
 * FredySettings is now a composition of independent config sections.
 * Each section is defined in src/core/config/sections/<name>.ts and
 * registered in src/core/config/sections/index.ts.
 *
 * To add a new section: write the file, register it, add the type here.
 * No existing code changes.
 *
 * See ARCHITECTURE_RULES.md §8 and docs/CONFIG_GUIDE.md.
 */

// Re-export all section config types for convenience.
import type { GeneralConfig } from "../core/config/sections/general";
import type { TelegramConfig } from "../core/config/sections/telegram";
import type { LanguageConfig } from "../core/config/sections/language";
import type { SchedulerConfig } from "../core/config/sections/scheduler";
import type { CategoriesConfig } from "../core/config/sections/categories";
import type { AIConfig } from "../core/config/sections/ai";
import type { ProvidersConfig } from "../core/config/sections/providers";
import type { ContentConfig } from "../core/config/sections/content";
import type { QualityConfig } from "../core/config/sections/quality";
import type { DebugConfig } from "../core/config/sections/debug";
import type { LoggingConfig } from "../core/config/sections/logging";
import type { NasaConfig } from "../core/config/sections/nasa";
import type { PluginsConfig } from "../core/config/sections/plugins";
import type { FutureConfig } from "../core/config/sections/future";

/**
 * The complete Fredy settings blob.
 * Stored at KV `fredy:settings:<adminId>`.
 * Rarely changes — edit via admin panel.
 */
export interface FredySettings {
  readonly general: GeneralConfig;
  readonly telegram: TelegramConfig;
  readonly language: LanguageConfig;
  readonly scheduler: SchedulerConfig;
  readonly categories: CategoriesConfig;
  readonly ai: AIConfig;
  readonly providers: ProvidersConfig;
  readonly content: ContentConfig;
  readonly quality: QualityConfig;
  readonly debug: DebugConfig;
  readonly logging: LoggingConfig;
  readonly nasa: NasaConfig;
  readonly plugins: PluginsConfig;
  readonly future: FutureConfig;
}

/**
 * Fredy state — frequently-changing runtime data.
 * Stored at KV `fredy:state:<adminId>`, separate from settings.
 * See ARCHITECTURE_RULES.md §8.4 (config vs state separation).
 */
export interface FredyState {
  readonly stats: {
    readonly processed: number;
    readonly published: number;
    readonly rejected: number;
    readonly failed: number;
  };
  readonly lastPublishedAt: number | null;
  readonly lastSource: string | null;
  readonly lastCategory: "A" | "B" | "C" | null;
  readonly lastSourceEmojis: readonly string[];
  readonly today: {
    readonly date: string; // YYYY-MM-DD
    readonly slotsFired: readonly number[];
    readonly categoriesPublished: Readonly<Record<"A" | "B" | "C", number>>;
  };
}

/** A patch applied to settings via the admin panel. Deep-merged. */
export type SettingsPatch = Partial<{
  general: Partial<GeneralConfig>;
  telegram: Partial<TelegramConfig>;
  language: Partial<LanguageConfig>;
  scheduler: Partial<SchedulerConfig>;
  categories: Partial<CategoriesConfig>;
  ai: Partial<AIConfig>;
  providers: Partial<ProvidersConfig>;
  content: Partial<ContentConfig>;
  quality: Partial<QualityConfig>;
  debug: Partial<DebugConfig>;
  logging: Partial<LoggingConfig>;
  nasa: Partial<NasaConfig>;
  plugins: Partial<PluginsConfig>;
  future: Partial<FutureConfig>;
}>;

/** Result of a config update operation. */
export interface ConfigUpdateResult {
  readonly ok: boolean;
  readonly settings: FredySettings;
  readonly error?: string;
}

/** Result of a config validation operation. */
export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly errors: Readonly<Record<string, string>>;
}

/** Result of a config export operation. */
export interface ConfigExportResult {
  readonly ok: boolean;
  readonly json: string;
  readonly version: string;
  readonly exportedAt: string;
}

/** Result of a config import operation. */
export interface ConfigImportResult {
  readonly ok: boolean;
  readonly settings: FredySettings | null;
  readonly error?: string;
}

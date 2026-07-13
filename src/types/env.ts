/**
 * src/types/env.ts
 * Cloudflare Worker environment bindings. Mirrors wrangler.toml.
 */

export interface Env {
  // KV bindings — name must match wrangler.toml binding = "Fredy_SETTINGS"
  Fredy_SETTINGS: KVNamespace;

  // Non-secret vars
  ADMIN_ID: string;
  TARGET_CHANNEL: string;
  FOOTER_TEXT: string;
  DEBUG_MODE: string;
  DEFAULT_AI_PROVIDER: string;
  DEFAULT_LANGUAGE: string;
  SCHEDULER_TIMEZONE: string;
  SCHEDULE_SLOTS: string;
  SCHEDULE_JITTER_MINUTES: string;

  // Secrets
  BOT_TOKEN: string;
  GEMINI_API_KEY: string;
  OPENROUTER_API_KEY: string;
  CRON_KEY: string;
  GITHUB_TOKEN?: string;
  NEWSAPI_KEY?: string;
  NASA_API_KEY?: string;
  WEBHOOK_SECRET?: string;
  DEBUG_TOKEN?: string;
}

/**
 * The DI container shape. Built by `buildContainer(env)`.
 * Every entry point receives this instead of `env` directly.
 */
export interface Container {
  readonly env: Env;
  readonly tg: import("../services/telegram").TelegramService;
  readonly kv: import("../services/kv-store").KVStore;
  readonly ai: import("../services/ai-service").AIService;
  readonly soul: import("../services/soul-loader").SoulLoader;
  readonly plugins: import("../services/plugin-manager").PluginManager;
  readonly providers: import("../services/provider-registry").ProviderRegistry;
  readonly categories: import("../services/category-manager").CategoryManager;
  readonly scheduler: import("../services/scheduler-service").SchedulerService;
  readonly lang: import("../services/language-manager").LanguageManager;
  readonly queue: import("../services/content-queue").ContentQueue;
  readonly emoji: import("../services/emoji-rotator").EmojiRotator;
  readonly config: import("../services/config-service").ConfigService;
  readonly debug: import("../services/debug-service").DebugService;
  readonly logger: import("../services/logger").Logger;
  // Content engine
  readonly content: import("../services/content-manager").ContentManager;
  readonly contentValidator: import("../services/content-validator").ContentValidator;
  readonly categoryResolver: import("../services/category-resolver").CategoryResolver;
  readonly duplicateDetector: import("../services/duplicate-detector").DuplicateDetector;
  readonly contentFormatter: import("../services/content-formatter").ContentFormatter;
  readonly contentNormalizer: import("../services/content-normalizer").ContentNormalizer;
  readonly enrichmentEngine: import("../services/enrichment-engine").EnrichmentEngine;
  readonly taggingSystem: import("../services/tagging-system").TaggingSystem;
  readonly sourceFormatter: import("../services/source-formatter").SourceFormatter;
  readonly mediaHandler: import("../services/media-handler").MediaHandler;
  readonly mediaResolver: import("../services/media-resolver").MediaResolver;
  // Scheduler & publishing engine
  readonly timeGenerator: import("../services/time-generator").TimeGenerator;
  readonly dailyPlanner: import("../services/daily-planner").DailyPlanner;
  readonly jobQueue: import("../services/job-queue").JobQueue;
  readonly publishValidator: import("../services/publish-validator").PublishValidator;
  readonly retryManager: import("../services/retry-manager").RetryManager;
  readonly history: import("../services/history-service").HistoryService;
  // Final publishing engine
  readonly hookEngine: import("../services/hook-engine").HookEngine;
  readonly uxLayer: import("../services/ux-layer").UXLayer;
  readonly finalPublisher: import("../services/final-publisher").FinalPublisher;
}

/** Execution context passed from the Worker `fetch`/`scheduled` handler. */
export interface WorkerContext {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly container: Container;
}

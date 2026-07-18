/**
 * src/container.ts
 * DI container. Wires all services, plugins, and registries in dependency order.
 * See ARCHITECTURE_RULES.md §13.
 *
 * Adding a new plugin = add it here. No edits to orchestrators or services.
 */

import type { Container, Env } from "./types/env";

// Services
import { KVStore } from "./services/kv-store";
import { TelegramService } from "./services/telegram";
import { Logger } from "./services/logger";
import { ConfigService, buildConfigRegistry } from "./services/config-service";
import { ConfigCache, sharedConfigCache } from "./services/config-cache";
import { ConfigRepository } from "./services/config-repository";
import { SoulLoader } from "./services/soul-loader";
import { AIService } from "./services/ai-service";
import { PromptBuilder } from "./services/prompt-builder";
import { LanguageInjector } from "./services/language-injector";
import { ResponseParser } from "./services/response-parser";
import { RetryHandler } from "./services/retry-handler";
import { FallbackHandler } from "./services/fallback-handler";
import { TokenTracker } from "./services/token-tracker";
import { QualityEngine } from "./services/quality-engine";
import { PluginManager } from "./services/plugin-manager";
import { ProviderRegistry } from "./services/provider-registry";
import { PluginLoader } from "./services/plugin-loader";
import { CategoryManager } from "./services/category-manager";
import { SchedulerService } from "./services/scheduler-service";
import { LanguageManager } from "./services/language-manager";
import { ContentQueue } from "./services/content-queue";
import { EmojiRotator } from "./services/emoji-rotator";
import { DebugService } from "./services/debug-service";
// Content engine
import { ContentManager } from "./services/content-manager";
import { ContentValidator } from "./services/content-validator";
import { CategoryResolver } from "./services/category-resolver";
import { DuplicateDetector } from "./services/duplicate-detector";
import { ContentFormatter } from "./services/content-formatter";
import { ContentNormalizer } from "./services/content-normalizer";
import { EnrichmentEngine } from "./services/enrichment-engine";
import { TaggingSystem } from "./services/tagging-system";
import { SourceFormatter } from "./services/source-formatter";
import { MediaHandler } from "./services/media-handler";
import { MediaResolver } from "./services/media-resolver";
import { PopularityFilter } from "./services/popularity-filter";
import { FreshnessFilter } from "./services/freshness-filter";
import { ContentEnricher } from "./services/content-enricher";
import { CandidateRanker } from "./services/candidate-ranker";
import { PipelineLogger } from "./services/pipeline-logger";
// Scheduler & publishing engine
import { TimeGenerator } from "./services/time-generator";
import { DailyPlanner } from "./services/daily-planner";
import { JobQueue } from "./services/job-queue";
import { PublishValidator } from "./services/publish-validator";
import { RetryManager } from "./services/retry-manager";
import { HistoryService } from "./services/history-service";
import { QuietHoursChecker } from "./services/quiet-hours-checker";
import { TickLogger } from "./services/tick-logger";
import { StrategyEngine } from "./services/strategy-engine";
// Final publishing engine
import { HookEngine } from "./services/hook-engine";
import { UXLayer } from "./services/ux-layer";
import { FinalPublisher } from "./services/final-publisher";

// Bundled default soul
const BUNDLED_SOUL = `
# Identity

You are Fredy.
You are the publishing intelligence behind ILIVIR3.
Your purpose is to deliver useful knowledge.

# Personality

Curious. Calm. Technical. Developer-first.
Professional without sounding corporate.

(Full soul loaded from docs/soul.md — this is a fallback.)
`.trim();

/**
 * Build the DI container. Called once per Worker isolate.
 * Order matters — services that depend on others must be constructed after
 * their dependencies.
 */
export function buildContainer(env: Env): Container {
  // Layer 0: KV + Logger (no deps)
  const kv = new KVStore({ kv: env.Fredy_SETTINGS });
  const logger = new Logger({
    kv: env.Fredy_SETTINGS,
    isDebugMode: () => env.DEBUG_MODE === "true",
  });

  // Layer 1: Config (registry + repository + cache + service)
  // v8.0.0: Use the shared singleton cache so write-invalidation propagates
  // across all container instances within the same isolate.
  const registry = buildConfigRegistry();
  const repository = new ConfigRepository({ kv });
  void ConfigCache; // referenced for side effects / type import
  const cache = sharedConfigCache;
  const config = new ConfigService({ kv, env, repository, cache, registry });

  // Layer 2: Telegram + Debug (depend on kv + logger)
  const tg = new TelegramService({
    botToken: env.BOT_TOKEN,
    webhookSecret: env.WEBHOOK_SECRET,
  });
  const debug = new DebugService({
    kv,
    env,
    logger,
    isDebugMode: () => env.DEBUG_MODE === "true",
  });

  // Layer 3: Soul + Language + Emoji (depend on kv + config)
  const soul = new SoulLoader({ kv, defaultSoul: BUNDLED_SOUL });
  const lang = new LanguageManager({
    defaultLanguage: env.DEFAULT_LANGUAGE === "fa" ? "fa" : "en",
  });
  const emoji = new EmojiRotator({
    kv,
    state: () => config.getState(Number(env.ADMIN_ID)),
  });

  // Layer 4: Plugin Manager + Provider Registry + Plugin Loader
  const plugins = new PluginManager({ kv, logger });
  const providers = new ProviderRegistry({ logger, env });
  const pluginLoader = new PluginLoader({
    env,
    kv,
    logger,
    pluginManager: plugins,
    providerRegistry: providers,
  });
  pluginLoader.loadAll();

  // Layer 5: AI layer
  const languageInjector = new LanguageInjector({
    config: async () => (await config.getSettings(Number(env.ADMIN_ID))).language,
    envDefaultLanguage: () => env.DEFAULT_LANGUAGE,
  });
  const promptBuilder = new PromptBuilder({ languageInjector });
  const responseParser = new ResponseParser({});
  const retryHandler = new RetryHandler({ logger });
  const fallbackHandler = new FallbackHandler({ logger });
  const tokenTracker = new TokenTracker({ logger });
  const qualityEngine = new QualityEngine({ logger });

  const ai = new AIService({
    providers: providers.list().filter((p) => p.isConfigured(env)),
    preferred: env.DEFAULT_AI_PROVIDER as "gemini" | "openrouter" | "auto",
    soul,
    promptBuilder,
    responseParser,
    retryHandler,
    fallbackHandler,
    tokenTracker,
    qualityEngine,
    logger,
    settings: () => config.getSettings(Number(env.ADMIN_ID)),
    kv, // for anti-repeat recent-hashes loading
  });

  // Layer 6: Queue + Categories
  // CRITICAL FIX: ContentQueue requires logger — without it, every enqueue()
  // throws "Cannot read properties of undefined (reading 'info')"
  const queue = new ContentQueue({ kv, logger });
  const categories = new CategoryManager({
    kv,
    config: async () => (await config.getSettings(Number(env.ADMIN_ID))).categories,
    state: () => config.getState(Number(env.ADMIN_ID)),
  });

  // Layer 7: Content Engine
  const contentValidator = new ContentValidator({ logger, pluginManager: plugins });
  const categoryResolver = new CategoryResolver({ logger, pluginManager: plugins });
  const duplicateDetector = new DuplicateDetector({
    kv,
    logger,
    ttlHours: 24 * 7,
  });
  const mediaHandler = new MediaHandler({ logger });
  const mediaResolver = new MediaResolver({ logger });
  const sourceFormatter = new SourceFormatter({
    logger,
    state: () => config.getState(Number(env.ADMIN_ID)),
  });
  const contentFormatter = new ContentFormatter({
    logger,
    mediaHandler,
    mediaResolver,
    sourceFormatter,
  });
  const contentNormalizer = new ContentNormalizer({
    logger,
    mediaResolver,
    pluginManager: plugins,
  });
  const enrichmentEngine = new EnrichmentEngine({ logger });
  const taggingSystem = new TaggingSystem({ logger });
  const popularityFilter = new PopularityFilter({ minScore: 30 });
  const freshnessFilter = new FreshnessFilter({});
  const contentEnricher = new ContentEnricher({ env, logger });
  const candidateRanker = new CandidateRanker({});
  const pipelineLogger = new PipelineLogger(kv);
  const content = new ContentManager({
    pluginManager: plugins,
    validator: contentValidator,
    categoryResolver,
    duplicateDetector,
    formatter: contentFormatter,
    normalizer: contentNormalizer,
    enrichmentEngine,
    taggingSystem,
    popularityFilter,
    freshnessFilter,
    contentEnricher,
    candidateRanker,
    pipelineLogger,
    queue,
    ai,
    soul,
    logger,
    settings: () => config.getSettings(Number(env.ADMIN_ID)),
  });

  // Layer 8: Scheduler & Publishing Engine
  const timeGenerator = new TimeGenerator({});
  const quietHoursChecker = new QuietHoursChecker();
  const tickLogger = new TickLogger(kv);
  const strategyEngine = new StrategyEngine({
    kv,
    logger,
    timeGenerator,
    quietHoursChecker,
    schedulerConfig: async () => (await config.getSettings(Number(env.ADMIN_ID))).scheduler,
    strategyConfig: async () => (await config.getSettings(Number(env.ADMIN_ID))).strategy,
  });
  const dailyPlanner = new DailyPlanner({
    kv,
    logger,
    timeGenerator,
    settings: () => config.getSettings(Number(env.ADMIN_ID)),
  });
  const jobQueue = new JobQueue({ kv, logger });
  const publishValidator = new PublishValidator({
    logger,
    pluginManager: plugins,
    duplicateDetector,
    settings: () => config.getSettings(Number(env.ADMIN_ID)),
  });
  const retryManager = new RetryManager({ logger });
  const history = new HistoryService({
    kv,
    logger,
    timezone: async () => (await config.getSettings(Number(env.ADMIN_ID))).scheduler.timezone,
  });
  // Final publishing engine
  const hookEngine = new HookEngine({ logger });
  const uxLayer = new UXLayer({
    logger,
    hookEngine,
    sourceFormatter,
  });
  const finalPublisher = new FinalPublisher({
    tg,
    uxLayer,
    validator: publishValidator,
    retryManager,
    history,
    logger,
    settings: () => config.getSettings(Number(env.ADMIN_ID)),
  });
  const scheduler = new SchedulerService({
    logger,
    dailyPlanner,
    jobQueue,
    publishingService: finalPublisher,
    contentManager: content,
    contentQueue: queue,
    history,
    quietHoursChecker,
    settings: () => config.getSettings(Number(env.ADMIN_ID)),
    // Auto-publish admin PM notification (mirrors manual publish path).
    tg,
    uxLayer,
    adminId: () => Number(env.ADMIN_ID ?? "0"),
  });

  return {
    env,
    tg,
    kv,
    ai,
    soul,
    plugins,
    providers,
    categories,
    scheduler,
    lang,
    queue,
    emoji,
    config,
    debug,
    logger,
    // Content engine
    content,
    contentValidator,
    categoryResolver,
    duplicateDetector,
    contentFormatter,
    contentNormalizer,
    enrichmentEngine,
    taggingSystem,
    sourceFormatter,
    mediaHandler,
    mediaResolver,
    popularityFilter,
    freshnessFilter,
    contentEnricher,
    candidateRanker,
    pipelineLogger,
    // Scheduler & publishing engine
    timeGenerator,
    dailyPlanner,
    jobQueue,
    publishValidator,
    retryManager,
    quietHoursChecker,
    tickLogger,
    strategyEngine,
    history,
    // Final publishing engine
    hookEngine,
    uxLayer,
    finalPublisher,
  };
}

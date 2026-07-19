/**
 * src/services/plugin-loader.ts
 * Auto-loads and registers all plugins at startup.
 *
 * This is the bridge between the plugin barrels (src/plugins/sources/index.ts,
 * src/plugins/ai/index.ts) and the PluginManager / ProviderRegistry.
 *
 * On Cloudflare Workers, we can't do filesystem auto-discovery at runtime.
 * Instead, the loader statically imports all plugin factories from the barrel
 * and registers them. Adding a plugin = create folder + add to barrel + add
 * factory here. This is the standard pattern for bundled environments.
 *
 * See ARCHITECTURE_RULES.md §5 (Plugin First) and §4.2 (One responsibility).
 */

import type { PluginManager } from "./plugin-manager";
import type { ProviderRegistry } from "./provider-registry";
import type { Logger } from "./logger";
import type { KVStore } from "./kv-store";
import type { Env } from "../types/env";
import { PluginLogger } from "./plugin-logger";

// Source plugins — Category A (Developer Content)
import { createGitHubPlugin } from "../plugins/sources/github/index";
import { createDevToPlugin } from "../plugins/sources/devto/index";
import { createStackExchangePlugin } from "../plugins/sources/stackexchange/index";
import { createRedditPlugin } from "../plugins/sources/reddit/index";
import { createGitHubReleasesPlugin } from "../plugins/sources/github-releases/index";

// Source plugins — Category B (Tech News)
import { createNewsPlugin } from "../plugins/sources/news/index";
import { createHackerNewsPlugin } from "../plugins/sources/hackernews/index";

// Source plugins — Category C (Support Content)
import { createNasaPlugin } from "../plugins/sources/nasa/index";
import { createJokePlugin } from "../plugins/sources/joke/index";
import { createXkcdPlugin } from "../plugins/sources/xkcd/index";
import { createGitHubTrendingPlugin } from "../plugins/sources/github-trending/index";
import { createWikimediaPlugin } from "../plugins/sources/wikimedia/index";

// v11: New Tier-Based Source Plugins
// Tier S — Core providers (refresh every 2h)
import { createGitHubEventsPlugin } from "../plugins/sources/github-events/index";
import { createHackerNewsAlgoliaPlugin } from "../plugins/sources/hackernews-algolia/index";

// Tier A — Important providers (refresh every 6h)
import { createCloudflareBlogPlugin } from "../plugins/sources/cloudflare-blog/index";
import { createHuggingFaceBlogPlugin } from "../plugins/sources/huggingface-blog/index";
import { createProductHuntPlugin } from "../plugins/sources/producthunt/index";

// Tier B — Supporting providers (refresh every 12h)
import { createGitHubSecurityPlugin } from "../plugins/sources/github-security/index";
import { createOpenAINewsPlugin } from "../plugins/sources/openai-news/index";
import { createRedditV2Plugin } from "../plugins/sources/reddit-v2/index";

// AI providers
import { GeminiProvider } from "../plugins/ai/gemini";
import { OpenRouterProvider } from "../plugins/ai/openrouter";

export interface PluginLoaderDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly pluginManager: PluginManager;
  readonly providerRegistry: ProviderRegistry;
}

export class PluginLoader {
  constructor(private readonly deps: PluginLoaderDeps) {}

  /**
   * Load and register all plugins. Called once at container construction.
   * Each plugin gets a PluginLogger bound to its ID.
   */
  loadAll(): void {
    this.loadSources();
    this.loadProviders();
    this.deps.logger.info("source.fetch_start", {
      message: `Loaded ${this.deps.pluginManager.list().length} source plugins, ${this.deps.providerRegistry.list().length} AI providers`,
    });
  }

  /** Register all content source plugins. */
  private loadSources(): void {
    const sources = [
      // ─── Legacy providers (v9.x, kept for backward compat, disabled by default) ───
      { id: "news", factory: createNewsPlugin },            // Tier: legacy
      { id: "joke", factory: createJokePlugin },            // Tier: legacy
      { id: "wikimedia", factory: createWikimediaPlugin },  // Tier: legacy
      { id: "hackernews", factory: createHackerNewsPlugin },// Tier: legacy (superseded by hackernews-algolia)
      { id: "reddit", factory: createRedditPlugin },        // Tier: legacy (superseded by reddit-v2)

      // ─── v11 Tier S — Core providers (refresh every 2h) ───
      { id: "github", factory: createGitHubPlugin },
      { id: "github-releases", factory: createGitHubReleasesPlugin },
      { id: "github-trending", factory: createGitHubTrendingPlugin },
      { id: "github-events", factory: createGitHubEventsPlugin },
      { id: "devto", factory: createDevToPlugin },
      { id: "hackernews-algolia", factory: createHackerNewsAlgoliaPlugin },
      { id: "nasa", factory: createNasaPlugin },

      // ─── v11 Tier A — Important providers (refresh every 6h) ───
      { id: "stackexchange", factory: createStackExchangePlugin },
      { id: "cloudflare-blog", factory: createCloudflareBlogPlugin },
      { id: "huggingface-blog", factory: createHuggingFaceBlogPlugin },
      { id: "producthunt", factory: createProductHuntPlugin },

      // ─── v11 Tier B — Supporting providers (refresh every 12h) ───
      { id: "xkcd", factory: createXkcdPlugin },
      { id: "reddit-v2", factory: createRedditV2Plugin },
      { id: "github-security", factory: createGitHubSecurityPlugin },
      { id: "openai-news", factory: createOpenAINewsPlugin },
    ];

    for (const { id, factory } of sources) {
      try {
        const pluginLogger = new PluginLogger({
          logger: this.deps.logger,
          pluginId: id,
        });
        this.deps.pluginManager.register(() =>
          factory({
            env: this.deps.env,
            kv: this.deps.kv,
            logger: pluginLogger,
          }),
        );
      } catch (error) {
        this.deps.logger.error("source.fetch_error", {
          pluginId: id,
          error: error instanceof Error ? error.message : String(error),
          message: `Failed to load plugin "${id}"`,
        });
      }
    }
  }

  /** Register all AI provider plugins. */
  private loadProviders(): void {
    const providers = [
      { factory: () => new GeminiProvider(this.deps.env), priority: 1 },
      { factory: () => new OpenRouterProvider(this.deps.env), priority: 2 },
    ];

    for (const { factory, priority } of providers) {
      try {
        const provider = factory();
        this.deps.providerRegistry.register(provider, priority);
      } catch (error) {
        this.deps.logger.error("ai.error", {
          error: error instanceof Error ? error.message : String(error),
          message: "Failed to load AI provider",
        });
      }
    }
  }
}

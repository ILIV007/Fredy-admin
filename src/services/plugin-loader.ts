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
import { createGitHubPlugin } from "../plugins/sources/github";
import { createDevToPlugin } from "../plugins/sources/devto";
import { createStackExchangePlugin } from "../plugins/sources/stackexchange";
import { createRedditPlugin } from "../plugins/sources/reddit";
import { createGitHubReleasesPlugin } from "../plugins/sources/github-releases";

// Source plugins — Category B (Tech News)
import { createNewsPlugin } from "../plugins/sources/news";
import { createHackerNewsPlugin } from "../plugins/sources/hackernews";

// Source plugins — Category C (Support Content)
import { createNasaPlugin } from "../plugins/sources/nasa";
import { createJokePlugin } from "../plugins/sources/joke";
import { createXkcdPlugin } from "../plugins/sources/xkcd";
import { createGitHubTrendingPlugin } from "../plugins/sources/github-trending";
import { createWikimediaPlugin } from "../plugins/sources/wikimedia";

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
      // Category A — Developer Content
      { id: "github", factory: createGitHubPlugin },
      { id: "devto", factory: createDevToPlugin },
      { id: "stackexchange", factory: createStackExchangePlugin },
      { id: "reddit", factory: createRedditPlugin },
      { id: "github-releases", factory: createGitHubReleasesPlugin },
      // Category B — Tech News
      { id: "news", factory: createNewsPlugin },
      { id: "hackernews", factory: createHackerNewsPlugin },
      // Category C — Support Content
      { id: "nasa", factory: createNasaPlugin },
      { id: "joke", factory: createJokePlugin },
      { id: "xkcd", factory: createXkcdPlugin },
      { id: "github-trending", factory: createGitHubTrendingPlugin },
      { id: "wikimedia", factory: createWikimediaPlugin },
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

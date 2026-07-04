/**
 * src/plugins/sources/news/index.ts
 * NewsAPI content source plugin.
 *
 * Fetches technology news headlines from NewsAPI.org.
 * Category B (tech news only — no politics, no general news).
 * See FREDY_GUIDELINES.md §6.2.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { newsManifest } from "./manifest";

export interface NewsPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class NewsPlugin implements Plugin {
  readonly metadata = newsManifest;

  constructor(private readonly deps: NewsPluginDeps) {}

  getSource(): string {
    return this.metadata.id;
  }

  getCategory(): Category {
    return this.metadata.category;
  }

  supportsMedia(): boolean {
    return this.metadata.supportsImages;
  }

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Prompt 7 — call
    // GET https://newsapi.org/v2/top-headlines?category=technology&language=en&apiKey=...
    // Free tier: 100 req/day, 1 req/sec. Cache 60 min.
    // Filter out: politics, general news, opinion pieces.
    this.deps.logger.info("source.fetch_start", { plugin: "news" });
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const article = raw as Record<string, unknown>;
    return {
      id: String(article["url"] ?? "").slice(0, 100),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(article["title"] ?? ""),
      body: String(article["description"] ?? article["content"] ?? ""),
      url: String(article["url"] ?? ""),
      imageUrl: article["urlToImage"] ? String(article["urlToImage"]) : undefined,
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    if (!item.title || !item.url) return false;
    if (item.title.length < 10) return false;
    return true;
  }

  async health(): Promise<PluginStatus> {
    const hasKey = !!this.deps.env.NEWSAPI_KEY;
    return {
      pluginId: this.metadata.id,
      healthy: hasKey,
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: hasKey ? null : "NEWSAPI_KEY not set",
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastItemCount: null,
    };
  }
}

export function createNewsPlugin(deps: NewsPluginDeps): NewsPlugin {
  return new NewsPlugin(deps);
}

export { newsManifest } from "./manifest";

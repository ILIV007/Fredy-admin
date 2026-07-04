/**
 * src/plugins/sources/devto/index.ts
 * Dev.to content source plugin.
 *
 * Fetches top articles from the Dev.to (Forem) API.
 * Category A (programming, dev tools, frameworks, best practices).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { devtoManifest } from "./manifest";

const DEVTO_API = "https://dev.to/api/articles";

export interface DevToPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class DevToPlugin implements Plugin {
  readonly metadata = devtoManifest;

  constructor(private readonly deps: DevToPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "devto" });
    // TODO: implement real fetch.
    // GET https://dev.to/api/articles?top=7&per_page=10
    // Filter: positive_reactions_count > 50, has cover_image
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const article = raw as Record<string, unknown>;
    return {
      id: String(article["id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(article["title"] ?? ""),
      body: String(article["description"] ?? ""),
      url: String(article["url"] ?? ""),
      language: "en",
      publishedAt: article["published_at"] ? Date.parse(String(article["published_at"])) : undefined,
      imageUrl: article["cover_image"] ? String(article["cover_image"]) : undefined,
      metadata: { tags: article["tag_list"], reactions: article["positive_reactions_count"] },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("dev.to");
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
    };
  }
}

export function createDevToPlugin(deps: DevToPluginDeps): DevToPlugin {
  return new DevToPlugin(deps);
}

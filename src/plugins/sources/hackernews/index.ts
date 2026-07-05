/**
 * src/plugins/sources/hackernews/index.ts — REAL implementation.
 */
import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { hackernewsManifest } from "./manifest";

const HN_API = "https://hacker-news.firebaseio.com/v0";

export interface HackerNewsPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }

export class HackerNewsPlugin implements Plugin {
  readonly metadata = hackernewsManifest;
  constructor(private readonly deps: HackerNewsPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "hackernews" });
    const response = await fetch(`${HN_API}/topstories.json`);
    if (!response.ok) throw new Error(`HN API ${response.status}`);
    const ids = (await response.json()) as number[];
    const top10 = ids.slice(0, 10);
    const items = await Promise.all(top10.map(async (id) => {
      const r = await fetch(`${HN_API}/item/${id}.json`);
      return r.ok ? r.json() : null;
    }));
    return items.filter(Boolean).map((item) => this.normalize(item));
  }

  normalize(raw: unknown): SourceItem {
    const item = raw as Record<string, unknown>;
    return {
      id: String(item["id"] ?? ""), source: this.metadata.id, category: this.metadata.category,
      title: String(item["title"] ?? ""), body: String(item["text"] ?? item["url"] ?? ""),
      url: String(item["url"] ?? `https://news.ycombinator.com/item?id=${item["id"] ?? ""}`),
      language: "en", publishedAt: item["time"] ? Number(item["time"]) * 1000 : undefined,
      metadata: { score: item["score"], by: item["by"] }, fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean { return !!item.title && !!item.url && item.title.length > 5; }

  async health(): Promise<PluginStatus> {
    return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null };
  }
}
export function createHackerNewsPlugin(deps: HackerNewsPluginDeps): HackerNewsPlugin { return new HackerNewsPlugin(deps); }

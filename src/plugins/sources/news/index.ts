import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { newsManifest } from "./manifest";
export interface NewsPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class NewsPlugin implements Plugin {
  readonly metadata = newsManifest;
  constructor(private readonly deps: NewsPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "news" });
    if (!this.deps.env.NEWSAPI_KEY) throw new Error("NEWSAPI_KEY not set");
    const r = await fetch(`https://newsapi.org/v2/top-headlines?category=technology&language=en&pageSize=10&apiKey=${this.deps.env.NEWSAPI_KEY}`, { headers: { "User-Agent": "Fredy-Bot/1.0" } });
    if (!r.ok) throw new Error(`NewsAPI ${r.status}`);
    const data = await r.json() as { articles?: Array<Record<string, unknown>> };
    return (data.articles ?? []).map(a => this.normalize(a));
  }
  normalize(raw: unknown): SourceItem {
    const a = raw as Record<string, unknown>;
    return { id: String(a["url"] ?? "").slice(0,100), source: this.metadata.id, category: this.metadata.category, title: String(a["title"] ?? ""), body: String(a["description"] ?? a["content"] ?? ""), url: String(a["url"] ?? ""), language: "en", publishedAt: a["publishedAt"] ? Date.parse(String(a["publishedAt"])) : undefined, imageUrl: a["urlToImage"] ? String(a["urlToImage"]) : undefined, metadata: { author: a["author"] }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url && item.title.length > 10; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: !!this.deps.env.NEWSAPI_KEY, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: this.deps.env.NEWSAPI_KEY ? null : "NEWSAPI_KEY not set", consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createNewsPlugin(deps: NewsPluginDeps): NewsPlugin { return new NewsPlugin(deps); }

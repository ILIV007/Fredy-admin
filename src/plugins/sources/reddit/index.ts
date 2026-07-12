import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { redditManifest } from "./manifest";
const SUBS = ["programming", "javascript", "python", "rust", "golang", "typescript", "webdev", "MachineLearning"];
export interface RedditPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class RedditPlugin implements Plugin {
  readonly metadata = redditManifest;
  constructor(private readonly deps: RedditPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "reddit" });
    const sub = SUBS[Math.floor(Math.random()*SUBS.length)]!;
    const r = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=10`, { headers: { "User-Agent": "Fredy-Bot/1.0", "Accept": "application/json" } });
    if (!r.ok) throw new Error(`Reddit ${r.status}`);
    const data = await r.json() as { data?: { children?: Array<Record<string, unknown>> } };
    const posts = data.data?.children ?? [];
    return posts.map(p => this.normalize((p["data"] ?? p) as Record<string, unknown>));
  }
  normalize(raw: unknown): SourceItem {
    const p = raw as Record<string, unknown>;
    return { id: String(p["id"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: String(p["title"] ?? ""), body: String(p["selftext"] ?? p["url"] ?? ""), url: String(p["url"] ?? `https://www.reddit.com${p["permalink"] ?? ""}`), language: "en", publishedAt: p["created_utc"] ? Number(p["created_utc"])*1000 : undefined, metadata: { score: p["score"], subreddit: p["subreddit"] }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url && item.url.startsWith("http"); }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createRedditPlugin(deps: RedditPluginDeps): RedditPlugin { return new RedditPlugin(deps); }

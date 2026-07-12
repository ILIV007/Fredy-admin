import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { wikimediaManifest } from "./manifest";
export interface WikimediaPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class WikimediaPlugin implements Plugin {
  readonly metadata = wikimediaManifest;
  constructor(private readonly deps: WikimediaPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "wikimedia" });
    const now = new Date();
    const mm = String(now.getMonth()+1).padStart(2,"0");
    const dd = String(now.getDate()).padStart(2,"0");
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`, { headers: { "User-Agent": "Fredy-Bot/1.0 (https://github.com/fredy)" } });
    if (!r.ok) throw new Error(`Wikimedia ${r.status}`);
    const data = await r.json() as { events?: Array<Record<string, unknown>> };
    return (data.events ?? []).slice(0,10).map(e => this.normalize(e));
  }
  normalize(raw: unknown): SourceItem {
    const e = raw as Record<string, unknown>;
    const pages = e["pages"] as Array<Record<string, unknown>> | undefined;
    const page = pages?.[0];
    return { id: String(e["text"] ?? "").slice(0,100), source: this.metadata.id, category: this.metadata.category, title: String(e["text"] ?? "Today in History"), body: String(page?.["extract"] ?? e["text"] ?? ""), url: String((page?.["content_urls"] as Record<string, unknown>)?.["desktop"] ? ((page["content_urls"] as Record<string, Record<string, unknown>>)["desktop"]["page"]) : "https://en.wikipedia.org"), language: "en", imageUrl: page?.["thumbnail"] ? String((page["thumbnail"] as Record<string, unknown>)["source"] ?? "") : undefined, metadata: { year: e["year"] }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && item.title.length > 10; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createWikimediaPlugin(deps: WikimediaPluginDeps): WikimediaPlugin { return new WikimediaPlugin(deps); }

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { devtoManifest } from "./manifest";
export interface DevToPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class DevToPlugin implements Plugin {
  readonly metadata = devtoManifest;
  constructor(private readonly deps: DevToPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "devto" });
    const r = await fetch("https://dev.to/api/articles?top=7&per_page=10", { headers: { "User-Agent": "Fredy-Bot/1.0", "Accept": "application/json" } });
    if (!r.ok) throw new Error(`Dev.to ${r.status}`);
    const data = await r.json() as Array<Record<string, unknown>>;
    return data.map(a => this.normalize(a));
  }
  normalize(raw: unknown): SourceItem {
    const a = raw as Record<string, unknown>;
    return { id: String(a["id"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: String(a["title"] ?? ""), body: String(a["description"] ?? ""), url: String(a["url"] ?? ""), language: "en", publishedAt: a["published_at"] ? Date.parse(String(a["published_at"])) : undefined, imageUrl: a["cover_image"] ? String(a["cover_image"]) : undefined, metadata: { tags: a["tag_list"], reactions: a["positive_reactions_count"] }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createDevToPlugin(deps: DevToPluginDeps): DevToPlugin { return new DevToPlugin(deps); }

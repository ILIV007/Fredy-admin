import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { xkcdManifest } from "./manifest";
export interface XkcdPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class XkcdPlugin implements Plugin {
  readonly metadata = xkcdManifest;
  constructor(private readonly deps: XkcdPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "xkcd" });
    const r = await fetch("https://xkcd.com/info.json");
    if (!r.ok) throw new Error(`XKCD API ${r.status}`);
    const data = await r.json() as Record<string, unknown>;
    return [this.normalize(data)];
  }
  normalize(raw: unknown): SourceItem {
    const c = raw as Record<string, unknown>;
    const num = c["num"]; const img = String(c["img"] ?? "");
    return { id: `xkcd-${num ?? ""}`, source: this.metadata.id, category: this.metadata.category, title: String(c["title"] ?? `XKCD #${num ?? ""}`), body: String(c["alt"] ?? ""), url: `https://xkcd.com/${num ?? ""}/`, language: "en", imageUrl: img, media: { type: "image", url: img, alt: String(c["alt"] ?? ""), source: "provider" }, metadata: { num }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.imageUrl; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createXkcdPlugin(deps: XkcdPluginDeps): XkcdPlugin { return new XkcdPlugin(deps); }

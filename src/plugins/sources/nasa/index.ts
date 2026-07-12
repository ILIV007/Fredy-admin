import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nasaManifest } from "./manifest";
export interface NasaPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class NasaPlugin implements Plugin {
  readonly metadata = nasaManifest;
  constructor(private readonly deps: NasaPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "nasa" });
    const key = this.deps.env.NASA_API_KEY || "DEMO_KEY";
    const r = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${key}`, { headers: { "User-Agent": "Fredy-Bot/1.0" } });
    if (!r.ok) throw new Error(`NASA ${r.status}`);
    const data = await r.json() as Record<string, unknown>;
    return [this.normalize(data)];
  }
  normalize(raw: unknown): SourceItem {
    const a = raw as Record<string, unknown>;
    const mt = String(a["media_type"] ?? "image");
    const img = mt === "image" ? String(a["hdurl"] ?? a["url"] ?? "") : String(a["url"] ?? "");
    return { id: String(a["date"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: String(a["title"] ?? ""), body: String(a["explanation"] ?? ""), url: String(a["url"] ?? "https://apod.nasa.gov/"), language: "en", publishedAt: a["date"] ? Date.parse(String(a["date"])) : undefined, imageUrl: img, media: { type: mt === "video" ? "video" : "image", url: img, alt: String(a["title"] ?? ""), source: "provider" }, metadata: { mediaType: mt }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createNasaPlugin(deps: NasaPluginDeps): NasaPlugin { return new NasaPlugin(deps); }

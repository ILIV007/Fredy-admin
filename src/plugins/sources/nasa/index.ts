/**
 * src/plugins/sources/nasa/index.ts — REAL implementation.
 * Fetches NASA Astronomy Picture of the Day.
 */
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
    const apiKey = this.deps.env.NASA_API_KEY || "DEMO_KEY";
    const url = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NASA API ${response.status}`);
    const data = await response.json() as Record<string, unknown>;
    return [this.normalize(data)];
  }

  normalize(raw: unknown): SourceItem {
    const apod = raw as Record<string, unknown>;
    const mediaType = String(apod["media_type"] ?? "image");
    const imageUrl = mediaType === "image" ? String(apod["hdurl"] ?? apod["url"] ?? "") : String(apod["url"] ?? "");
    return {
      id: String(apod["date"] ?? ""), source: this.metadata.id, category: this.metadata.category,
      title: String(apod["title"] ?? ""), body: String(apod["explanation"] ?? ""),
      url: String(apod["url"] ?? "https://apod.nasa.gov/"), language: "en",
      publishedAt: apod["date"] ? Date.parse(String(apod["date"])) : undefined,
      imageUrl, media: { type: mediaType === "video" ? "video" : "image", url: imageUrl, alt: String(apod["title"] ?? ""), source: "provider" },
      metadata: { mediaType }, fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean { return !!item.title && !!item.imageUrl; }

  async health(): Promise<PluginStatus> {
    return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null };
  }
}
export function createNasaPlugin(deps: NasaPluginDeps): NasaPlugin { return new NasaPlugin(deps); }

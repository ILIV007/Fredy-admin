/**
 * src/plugins/sources/nasa/index.ts
 * NASA APOD content source plugin.
 *
 * Fetches the Astronomy Picture of the Day from NASA's API.
 * Category C (NASA / joke / quote / fact — image-first).
 * See FREDY_GUIDELINES.md §6.3, §8.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nasaManifest } from "./manifest";

export interface NasaPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class NasaPlugin implements Plugin {
  readonly metadata = nasaManifest;

  constructor(private readonly deps: NasaPluginDeps) {}

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
    // GET https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY
    // Cache 6 hours (one APOD per day).
    // If media_type === "video", return the YouTube URL as the source URL.
    this.deps.logger.info("source.fetch_start", { plugin: "nasa" });
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const apod = raw as Record<string, unknown>;
    const mediaType = String(apod["media_type"] ?? "image");
    const imageUrl = mediaType === "image"
      ? String(apod["hdurl"] ?? apod["url"] ?? "")
      : String(apod["url"] ?? "");
    return {
      id: String(apod["date"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(apod["title"] ?? ""),
      body: String(apod["explanation"] ?? ""),
      url: String(apod["url"] ?? ""),
      imageUrl,
      metadata: { mediaType },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    if (!item.title || !item.imageUrl) return false;
    if (item.imageUrl.length < 10) return false;
    return true;
  }

  async health(): Promise<PluginStatus> {
    const hasKey = !!this.deps.env.NASA_API_KEY;
    return {
      pluginId: this.metadata.id,
      healthy: hasKey, // DEMO_KEY works but is rate-limited
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: hasKey ? null : "NASA_API_KEY not set (DEMO_KEY fallback available)",
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

export function createNasaPlugin(deps: NasaPluginDeps): NasaPlugin {
  return new NasaPlugin(deps);
}

export { nasaManifest } from "./manifest";

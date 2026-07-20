/**
 * src/plugins/sources/nasa/index.ts
 * NASA APOD content source plugin.
 *
 * v8.1.2: Simplified — fetches ONLY today's APOD (1 item, not 3).
 * Always English. The post should be just one line of English text
 * + source + footer. No extra content needed.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nasaManifest } from "./manifest";
export { nasaManifest } from "./manifest";

const NASA_API = "https://api.nasa.gov/planetary/apod";
const CACHE_KEY = "fredy:source:nasa:apod";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours (APOD only updates daily)

export interface NasaPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface APODResponse {
  date?: string;
  title?: string;
  explanation?: string;
  url?: string;
  hdurl?: string;
  media_type?: string;
  service_version?: string;
  copyright?: string;
}

export class NasaPlugin implements Plugin {
  readonly metadata = nasaManifest;

  constructor(private readonly deps: NasaPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "nasa" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "nasa" });
      return cached;
    }

    const apiKey = this.deps.env.NASA_API_KEY || "DEMO_KEY";

    // v8.1.2: Only fetch TODAY's APOD — one item, always English.
    const date = new Date().toISOString().split("T")[0]!;
    try {
      const params = new URLSearchParams({ api_key: apiKey, date });
      const url = `${NASA_API}?${params.toString()}`;

      const res = await fetch(url, {
        headers: { "User-Agent": "FredyBot/1.0 (Cloudflare Workers)" },
      });

      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", {
          plugin: "nasa", date, status: res.status,
        });
        return [];
      }

      const apod = await res.json() as APODResponse;

      if (!apod.url) {
        this.deps.logger.warn("source.fetch_error", {
          plugin: "nasa", date, reason: "missing url",
        });
        return [];
      }

      const items = [this.normalize(apod)];

      // Cache the result
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});

      this.deps.logger.info("source.fetch_success", {
        plugin: "nasa",
        itemCount: items.length,
        title: items[0]?.title,
        mediaType: (items[0]?.metadata as Record<string, unknown>)?.mediaType,
      });

      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "nasa", date,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  normalize(raw: unknown): SourceItem {
    const apod = raw as APODResponse;
    const mediaType = apod.media_type ?? "image";
    const imageUrl = mediaType === "image" ? (apod.url ?? apod.hdurl) : apod.url;

    // v8.1.2: Keep the body concise — just the explanation, trimmed.
    // The AI pipeline will still process it, but the content is simple
    // and always in English.
    const explanation = String(apod.explanation ?? "").trim();

    return {
      id: `nasa-${apod.date ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(apod.title ?? "NASA APOD"),
      body: explanation,
      url: String(apod.url ?? "https://apod.nasa.gov/"),
      imageUrl: imageUrl ?? undefined,
      language: "en", // v8.1.2: Always English
      publishedAt: apod.date ? Date.parse(apod.date) || undefined : undefined,
      media: (mediaType === "image" && imageUrl) ? {
        type: "image",
        url: imageUrl,
        alt: apod.title ?? "",
        source: "provider",
      } : undefined,
      metadata: {
        date: apod.date,
        copyright: apod.copyright,
        hdurl: apod.hdurl,
        serviceVersion: apod.service_version,
        mediaType,
      },
            displayIcon: this.metadata.displayIcon ?? "🌌",
      displaySource: this.metadata.displaySource ?? "Source",
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.body;
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastItemCount: null,
      // v11 Phase 3: Provider Analytics
      itemsAccepted: 0,
      itemsRejected: 0,
      averageLatencyMs: null,
      consecutiveEmptyFetches: 0,
      currentBackoffMultiplier: 1,
      lastRefreshAt: null,
    };
  }
}

export function createNasaPlugin(deps: NasaPluginDeps): NasaPlugin {
  return new NasaPlugin(deps);
}

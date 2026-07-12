/**
 * src/plugins/sources/nasa/index.ts
 * NASA APOD content source plugin.
 *
 * Fetches Astronomy Picture of the Day from NASA.
 * Category C (science / astronomy / inspiration).
 *
 * GET https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY
 * Free tier: 1000 req/day, 30 req/min (DEMO_KEY), or 1000/hr with personal key.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nasaManifest } from "./manifest";

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
  url?: string;          // low-res image or video thumbnail
  hdurl?: string;        // high-res image
  media_type?: string;   // "image" or "video"
  service_version?: string;
  copyright?: string;
}

export class NasaPlugin implements Plugin {
  readonly metadata = nasaManifest;

  constructor(private readonly deps: NasaPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "nasa" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "nasa" });
      return cached;
    }

    // Use personal API key if available, else DEMO_KEY
    const apiKey = this.deps.env.NASA_API_KEY || "DEMO_KEY";

    const params = new URLSearchParams({ api_key: apiKey });
    const url = `${NASA_API}?${params.toString()}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "FredyBot/1.0 (Cloudflare Workers)" },
    });

    if (!res.ok) {
      throw new Error(`NASA API ${res.status}: ${res.statusText}`);
    }

    const apod = await res.json() as APODResponse;

    // Only image type (skip video days for now)
    if (apod.media_type && apod.media_type !== "image") {
      this.deps.logger.info("source.fetch_skip", {
        plugin: "nasa",
        reason: `media_type=${apod.media_type}`,
      });
      return [];
    }

    const item = this.normalize(apod);

    // Cache the result
    await this.deps.kv.setJson(CACHE_KEY, [item], CACHE_TTL_SECONDS).catch(() => {});

    this.deps.logger.info("source.fetch_success", {
      plugin: "nasa",
      title: item.title,
      date: apod.date,
    });

    return [item];
  }

  normalize(raw: unknown): SourceItem {
    const apod = raw as APODResponse;
    const imageUrl = apod.hdurl ?? apod.url;
    return {
      id: `nasa-${apod.date ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(apod.title ?? "NASA APOD"),
      body: String(apod.explanation ?? ""),
      url: String(apod.url ?? "https://apod.nasa.gov/"),
      imageUrl: imageUrl ?? undefined,
      language: "en",
      publishedAt: apod.date ? Date.parse(apod.date) || undefined : undefined,
      media: imageUrl ? {
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
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.body;
  }

  async health(): Promise<PluginStatus> {
    const hasKey = !!this.deps.env.NASA_API_KEY;
    return {
      pluginId: this.metadata.id,
      healthy: true, // DEMO_KEY works without a key
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
    };
  }
}

export function createNasaPlugin(deps: NasaPluginDeps): NasaPlugin {
  return new NasaPlugin(deps);
}

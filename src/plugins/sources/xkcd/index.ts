/**
 * src/plugins/sources/xkcd/index.ts
 * XKCD content source plugin.
 *
 * Fetches the latest XKCD comic.
 * Category C (developer humor / dev facts).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { xkcdManifest } from "./manifest";
export { xkcdManifest } from "./manifest";

const XKCD_API = "https://xkcd.com/info.0.json";
const CACHE_KEY = "fredy:source:xkcd:latest";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

export interface XkcdPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface XkcdComic {
  num: number;
  title: string;
  img: string;
  alt: string;
  day: string;
  month: string;
  year: string;
}

export class XkcdPlugin implements Plugin {
  readonly metadata = xkcdManifest;

  constructor(private readonly deps: XkcdPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "xkcd" });

    // Check cache first
    const cached = await this.deps.kv.getJson<SourceItem>(CACHE_KEY).catch(() => null);
    if (cached) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "xkcd", id: cached.id });
      return [cached];
    }

    // Fetch fresh comic
    const res = await fetch(XKCD_API, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`XKCD API ${res.status}: ${res.statusText}`);
    }

    const comic = await res.json() as XkcdComic;
    const item = this.normalize(comic);

    // Cache the result
    await this.deps.kv.setJson(CACHE_KEY, item, CACHE_TTL_SECONDS).catch(() => {});

    return [item];
  }

  normalize(raw: unknown): SourceItem {
    const comic = raw as XkcdComic;
    return {
      id: `xkcd-${comic.num}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: comic.title || `XKCD #${comic.num}`,
      body: comic.alt || "",
      url: `https://xkcd.com/${comic.num}/`,
      language: "en",
      publishedAt: this.parseDate(comic.year, comic.month, comic.day),
      imageUrl: comic.img || undefined,
      media: comic.img ? {
        type: "image",
        url: comic.img,
        alt: comic.alt || "",
        source: "provider",
      } : undefined,
      metadata: { num: comic.num, alt: comic.alt },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.imageUrl;
  }

  private parseDate(year: string | undefined, month: string | undefined, day: string | undefined): number | undefined {
    if (!year || !month || !day) return undefined;
    const padded = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const t = Date.parse(padded);
    return Number.isNaN(t) ? undefined : t;
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
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

export function createXkcdPlugin(deps: XkcdPluginDeps): XkcdPlugin {
  return new XkcdPlugin(deps);
}

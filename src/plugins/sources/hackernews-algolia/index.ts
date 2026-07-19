/**
 * src/plugins/sources/hackernews-algolia/index.ts
 * Hacker News (Algolia) content source plugin — Tier S.
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { hackernewsAlgoliaManifest } from "./manifest";
export { hackernewsAlgoliaManifest } from "./manifest";

const ALGOLIA_API = "https://hn.algolia.com/api/v1";
const CACHE_KEY = "fredy:source:hackernews-algolia:top";
const CACHE_TTL_SECONDS = 2 * 3600; // 2 hours (Tier S)

export interface HackerNewsAlgoliaPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface HNHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  story_text?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
  tags?: readonly string[];
}

interface HNResponse {
  hits: readonly HNHit[];
}

export class HackerNewsAlgoliaPlugin implements Plugin {
  readonly metadata = hackernewsAlgoliaManifest;
  constructor(private readonly deps: HackerNewsAlgoliaPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "hackernews-algolia" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const headers = { "User-Agent": "FredyBot/1.0" };

    // Fetch front page stories sorted by popularity
    const url = `${ALGOLIA_API}/search?tags=front_page&hitsPerPage=20`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      this.deps.logger.warn("source.fetch_error", { plugin: "hackernews-algolia", status: res.status });
      return [];
    }

    const data = await res.json() as HNResponse;
    const items = data.hits
      .filter((h) => h.title && h.url)
      .map((h) => this.normalize(h))
      .slice(0, 15);

    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "hackernews-algolia",
      hits: data.hits.length,
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const hit = raw as HNHit;
    return {
      id: `hn-${hit.objectID}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(hit.title ?? ""),
      body: String(hit.story_text ?? "").slice(0, 500) || String(hit.title ?? ""),
      url: String(hit.url ?? ""),
      language: "en",
      publishedAt: hit.created_at ? Date.parse(hit.created_at) || undefined : undefined,
      metadata: {
        hnId: hit.objectID,
        author: hit.author,
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url;
  }

  /**
   * Per-provider quality filter (v11 Phase 2).
   * Requirements: score >= 120, comments >= 30, age <= 48h, valid URL.
   * Boost: score >= 500.
   */
  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const meta = item.metadata as { points?: number; comments?: number };
    const points = meta.points ?? 0;
    const comments = meta.comments ?? 0;

    if (points < 120) return null;
    if (comments < 30) return null;

    // Check age <= 48h
    if (item.publishedAt) {
      const ageHours = (Date.now() - item.publishedAt) / (3600 * 1000);
      if (ageHours > 48) return null;
    }

    let score = 75;
    if (points >= 1000) score = 98;
    else if (points >= 500) score = 92;
    else if (points >= 300) score = 85;
    else score = 78;

    return {
      item,
      score,
      reason: `points=${points}, comments=${comments}`,
      boost: points >= 500,
    };
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
      itemsAccepted: 0, itemsRejected: 0, averageLatencyMs: null,
      consecutiveEmptyFetches: 0, currentBackoffMultiplier: 1, lastRefreshAt: null,
    };
  }
}

export function createHackerNewsAlgoliaPlugin(deps: HackerNewsAlgoliaPluginDeps): HackerNewsAlgoliaPlugin {
  return new HackerNewsAlgoliaPlugin(deps);
}

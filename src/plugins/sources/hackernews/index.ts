/**
 * src/plugins/sources/hackernews/index.ts
 * Hacker News content source plugin.
 *
 * Fetches top stories from Hacker News (Y Combinator).
 * Category B (tech news, dev discussion).
 *
 * HN API: https://github.com/HackerNews/API
 * GET https://hacker-news.firebaseio.com/v0/topstories.json
 * GET https://hacker-news.firebaseio.com/v0/item/{id}.json
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { hackernewsManifest } from "./manifest";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const CACHE_KEY = "fredy:source:hackernews:top";
const CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

export interface HackerNewsPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface HNItem {
  id?: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  by?: string;
  time?: number;
  descendants?: number;
}

export class HackerNewsPlugin implements Plugin {
  readonly metadata = hackernewsManifest;

  constructor(private readonly deps: HackerNewsPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "hackernews" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "hackernews", count: cached.length });
      return cached;
    }

    // Get top story IDs (returns ~500 IDs)
    const idsRes = await fetch(`${HN_API}/topstories.json`, {
      headers: { "User-Agent": "FredyBot/1.0 (Cloudflare Workers)" },
    });

    if (!idsRes.ok) {
      throw new Error(`HN API ${idsRes.status}: ${idsRes.statusText}`);
    }

    const ids = (await idsRes.json() as number[]).slice(0, 15);

    // Fetch each item in parallel (HN API is fast and cached on CDN)
    const itemPromises = ids.map((id) =>
      fetch(`${HN_API}/item/${id}.json`, {
        headers: { "User-Agent": "FredyBot/1.0 (Cloudflare Workers)" },
      }).then((r) => r.ok ? r.json() as Promise<HNItem> : null).catch(() => null),
    );

    const items = await Promise.all(itemPromises);

    // Filter to valid stories with score > 50
    const valid = items
      .filter((x): x is HNItem => x !== null)
      .filter((item) => item.type === "story" && (item.score ?? 0) > 50 && item.title);

    const sourceItems = valid.map((item) => this.normalize(item));

    // Cache the result
    if (sourceItems.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, sourceItems, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "hackernews",
      idsChecked: ids.length,
      validStories: valid.length,
      returned: sourceItems.length,
    });

    return sourceItems;
  }

  normalize(raw: unknown): SourceItem {
    const item = raw as HNItem;
    const hnUrl = item.url && item.url.length > 0
      ? item.url
      : `https://news.ycombinator.com/item?id=${item.id ?? ""}`;
    return {
      id: `hn-${item.id ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(item.title ?? ""),
      body: String(item.text ?? ""),
      url: hnUrl,
      language: "en",
      publishedAt: item.time ? item.time * 1000 : undefined,
      metadata: {
        score: item.score,
        author: item.by,
        comments: item.descendants,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url;
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
    };
  }
}

export function createHackerNewsPlugin(deps: HackerNewsPluginDeps): HackerNewsPlugin {
  return new HackerNewsPlugin(deps);
}

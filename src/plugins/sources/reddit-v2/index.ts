/**
 * src/plugins/sources/reddit-v2/index.ts
 * Reddit Programming content source plugin (v2) — Tier B.
 *
 * Fetches top posts from r/programming.
 * Quality filter (v11 Phase 2): score >= 100, comments >= 20, not NSFW, not removed.
 *
 * Note: Reddit blocks some server-side requests. Uses old.reddit.com with a
 * browser-like User-Agent as a workaround.
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { redditV2Manifest } from "./manifest";
export { redditV2Manifest } from "./manifest";

const CACHE_KEY = "fredy:source:reddit-v2:top";
const CACHE_TTL_SECONDS = 12 * 3600; // 12 hours (Tier B)

const SUBREDDITS = ["programming", "technology", "MachineLearning", "webdev"];

export interface RedditV2PluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext?: string;
    url: string;
    permalink: string;
    score: number;
    num_comments: number;
    over_18?: boolean;
    removed_by_category?: string | null;
    created_utc: number;
    author: string;
    subreddit: string;
  };
}

export class RedditV2Plugin implements Plugin {
  readonly metadata = redditV2Manifest;

  constructor(private readonly deps: RedditV2PluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "reddit-v2" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    // v11.3.0: Reddit JSON API blocks Cloudflare Workers IPs.
    // Try JSON API first, fall back to RSS feed.
    const sub = SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)] ?? "programming";

    // Attempt 1: JSON API (may work with proper User-Agent)
    const jsonItems = await this.fetchJSON(sub);
    if (jsonItems.length > 0) return jsonItems;

    // Attempt 2: RSS fallback
    return this.fetchRSS(sub);
  }

  /** v11.3.0: JSON API fetch (may be blocked by Reddit). */
  private async fetchJSON(sub: string): Promise<readonly SourceItem[]> {
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      };

      const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=15`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", { plugin: "reddit-v2", sub, status: res.status, source: "json" });
        return [];
      }

      const data = await res.json() as { data?: { children?: readonly RedditPost[] } };
      const posts = data.data?.children ?? [];

      const items: SourceItem[] = [];
      for (const post of posts) {
        const item = this.normalize(post);
        if (this.validate(item)) items.push(item);
      }

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items.slice(0, 10), CACHE_TTL_SECONDS).catch(() => {});
      }

      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "reddit-v2", sub, source: "json",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** v11.3.0: RSS fallback — Reddit RSS feeds are more permissive. */
  private async fetchRSS(sub: string): Promise<readonly SourceItem[]> {
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      };

      const url = `https://www.reddit.com/r/${sub}/top.rss?t=day&limit=10`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", { plugin: "reddit-v2", sub, status: res.status, source: "rss" });
        return [];
      }

      const xml = await res.text();
      const items = this.parseRSS(xml, sub);

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items.slice(0, 10), CACHE_TTL_SECONDS).catch(() => {});
      }

      this.deps.logger.info("source.fetch_success", {
        plugin: "reddit-v2", sub, source: "rss", returned: items.length,
      });

      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "reddit-v2", sub, source: "rss",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** v11.3.0: Parse Reddit RSS XML. */
  private parseRSS(xml: string, sub: string): readonly SourceItem[] {
    const items: SourceItem[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1] ?? "";
      const title = this.extractTag(block, "title");
      const link = this.extractLink(block);
      const content = this.stripHtml(this.extractTag(block, "content"));
      const published = this.extractTag(block, "published");

      if (title && link) {
        items.push({
          id: `reddit-${title.slice(0, 30).replace(/\s+/g, "-")}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title,
          body: content.slice(0, 500) || title,
          url: link,
          language: "en",
          publishedAt: published ? Date.parse(published) || undefined : undefined,
          metadata: {
            subreddit: sub,
            source: "rss",
          },
          fetchedAt: Date.now(),
        });
      }
    }
    return items;
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const match = regex.exec(xml);
    return (match?.[1] ?? "").trim();
  }

  private extractLink(xml: string): string {
    const match = /<link[^>]*href="([^"]+)"/.exec(xml) || /<link>([^<]+)<\/link>/.exec(xml);
    return match?.[1] ?? "";
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
  }

  normalize(raw: unknown): SourceItem {
    const post = (raw as RedditPost).data;
    return {
      id: `reddit-${post.id}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: post.title,
      body: String(post.selftext ?? "").slice(0, 500) || post.title,
      url: post.url.startsWith("http") ? post.url : `https://reddit.com${post.permalink}`,
      language: "en",
      publishedAt: post.created_utc ? post.created_utc * 1000 : undefined,
      metadata: {
        score: post.score,
        comments: post.num_comments,
        author: post.author,
        subreddit: post.subreddit,
        permalink: `https://reddit.com${post.permalink}`,
        nsfw: post.over_18 ?? false,
        removed: !!post.removed_by_category,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url;
  }

  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const meta = item.metadata as {
      score?: number; comments?: number; nsfw?: boolean; removed?: boolean;
    };

    // Not NSFW
    if (meta.nsfw) return null;
    // Not removed
    if (meta.removed) return null;
    // Score >= 100
    if ((meta.score ?? 0) < 100) return null;
    // Comments >= 20
    if ((meta.comments ?? 0) < 20) return null;

    let score = 72;
    if ((meta.score ?? 0) >= 1000) score = 95;
    else if ((meta.score ?? 0) >= 500) score = 85;
    else if ((meta.score ?? 0) >= 200) score = 80;

    return {
      item,
      score,
      reason: `score=${meta.score}, comments=${meta.comments}`,
      boost: (meta.score ?? 0) >= 1000,
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

export function createRedditV2Plugin(deps: RedditV2PluginDeps): RedditV2Plugin {
  return new RedditV2Plugin(deps);
}

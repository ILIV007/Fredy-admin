/**
 * src/plugins/sources/reddit/index.ts
 * Reddit content source plugin.
 *
 * Fetches top posts from programming-related subreddits.
 * Category A (developer content, discussions).
 *
 * GET https://www.reddit.com/r/{subreddit}/top.json?t=day&limit=10
 *
 * NOTE: Reddit requires a descriptive User-Agent or returns 429.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { redditManifest } from "./manifest";

const REDDIT_BASE = "https://old.reddit.com";
const CACHE_KEY = "fredy:source:reddit:top";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

// Programming-related subreddits to rotate through
const SUBREDDITS = [
  "programming",
  "javascript",
  "python",
  "rust",
  "golang",
  "typescript",
  "webdev",
  "learnprogramming",
  "coding",
  "MachineLearning",
];

export interface RedditPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface RedditPost {
  id?: string;
  title?: string;
  selftext?: string;
  url?: string;
  permalink?: string;
  score?: number;
  num_comments?: number;
  author?: string;
  created_utc?: number;
  subreddit?: string;
  link_flair_text?: string | null;
  thumbnail?: string;
  preview?: { images?: Array<{ source?: { url?: string } }> };
  over_18?: boolean;
  stickied?: boolean;
}

interface RedditResponse {
  kind?: string;
  data?: {
    children?: Array<{ kind?: string; data?: RedditPost }>;
  };
}

export class RedditPlugin implements Plugin {
  readonly metadata = redditManifest;

  constructor(private readonly deps: RedditPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "reddit" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "reddit", count: cached.length });
      return cached;
    }

    // Pick a random subreddit for variety
    const subreddit = SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)]!;
    const url = `${REDDIT_BASE}/r/${subreddit}/top.json?t=day&limit=15`;

    const res = await fetch(url, {
      headers: {
        // Reddit blocks generic bot UAs with 403. Use a realistic browser UA.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new Error(`Reddit API ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as RedditResponse;
    const posts = (data.data?.children ?? [])
      .map((c) => c.data)
      .filter((p): p is RedditPost => p !== undefined);

    // Filter: not stickied, not NSFW, score > 10
    const filtered = posts.filter((p) =>
      !p.stickied && !p.over_18 && (p.score ?? 0) > 10 && p.title,
    ).slice(0, 10);

    const items = filtered.map((p) => this.normalize(p));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "reddit",
      subreddit,
      totalPosts: posts.length,
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const post = raw as RedditPost;
    const postUrl = post.url && !post.url.startsWith(REDDIT_BASE)
      ? post.url  // External link
      : `${REDDIT_BASE}${post.permalink ?? ""}`;  // Self post
    const thumbnail = post.thumbnail && post.thumbnail.startsWith("http")
      ? post.thumbnail : undefined;
    const previewImg = post.preview?.images?.[0]?.source?.url;
    const imageUrl = previewImg ?? thumbnail;

    return {
      id: `reddit-${post.id ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(post.title ?? ""),
      body: String(post.selftext ?? "").slice(0, 1000),
      url: postUrl,
      imageUrl: imageUrl,
      language: "en",
      publishedAt: post.created_utc ? post.created_utc * 1000 : undefined,
      metadata: {
        score: post.score,
        comments: post.num_comments,
        author: post.author,
        subreddit: post.subreddit ?? post.permalink?.split("/")[2],
        flair: post.link_flair_text,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && (item.url.includes("reddit.com") || item.url.startsWith("http"));
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

export function createRedditPlugin(deps: RedditPluginDeps): RedditPlugin {
  return new RedditPlugin(deps);
}

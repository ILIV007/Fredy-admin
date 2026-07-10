/**
 * src/plugins/sources/reddit/index.ts
 * Reddit content source plugin (programming-related subreddits).
 *
 * Fetches top posts from r/programming, r/learnprogramming, r/javascript, etc.
 * Category A (programming, dev tools, frameworks).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { redditManifest } from "./manifest";

const REDDIT_API = "https://www.reddit.com";

/** Subreddits to fetch from. */
const SUBREDDITS = [
  "programming",
  "learnprogramming",
  "javascript",
  "python",
  "rust",
  "golang",
  "typescript",
  "webdev",
];

export interface RedditPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class RedditPlugin implements Plugin {
  readonly metadata = redditManifest;

  constructor(private readonly deps: RedditPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "reddit" });
    // TODO: implement real fetch.
    // GET /r/<subreddit>/top.json?t=day&limit=10 for each subreddit
    // Filter: score > 100, not stickied, is_self=false (link posts)
    void SUBREDDITS;
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const post = (raw as Record<string, unknown>)["data"] as Record<string, unknown> ?? raw as Record<string, unknown>;
    return {
      id: String(post["id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(post["title"] ?? ""),
      body: String(post["selftext"] ?? post["url"] ?? ""),
      url: String(post["url"] ?? `https://www.reddit.com${post["permalink"] ?? ""}`),
      language: "en",
      publishedAt: post["created_utc"] ? Number(post["created_utc"]) * 1000 : undefined,
      imageUrl: post["preview"] ? this.extractPreview(post["preview"]) : undefined,
      metadata: { score: post["score"], subreddit: post["subreddit"], author: post["author"] },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.startsWith("http");
  }

  private extractPreview(preview: unknown): string | undefined {
    if (typeof preview !== "object" || preview === null) return undefined;
    const images = (preview as Record<string, unknown>)["images"] as Array<Record<string, unknown>> | undefined;
    if (!images || images.length === 0) return undefined;
    const source = images[0]?.["source"] as Record<string, unknown> | undefined;
    return source?.["url"] ? String(source["url"]).replace(/&amp;/g, "&") : undefined;
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

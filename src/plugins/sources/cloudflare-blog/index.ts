/**
 * src/plugins/sources/cloudflare-blog/index.ts
 * Cloudflare Blog RSS content source plugin — Tier A.
 *
 * Fetches and parses the Cloudflare blog RSS feed.
 * Quality filter (v11 Phase 2): prefer topics Workers, AI, Security, Performance, Networking.
 * Ignores minor announcements.
 *
 * https://blog.cloudflare.com/rss/
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { cloudflareBlogManifest } from "./manifest";
export { cloudflareBlogManifest } from "./manifest";

const RSS_URL = "https://blog.cloudflare.com/rss/";
const CACHE_KEY = "fredy:source:cloudflare-blog:latest";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours (Tier A)

/** Preferred topics (v11 Phase 2 spec). */
const PREFERRED_TOPICS = [
  "workers", "ai", "security", "performance", "networking",
  "d1", "r2", "kv", "pages", "wrangler", "edge",
];

export interface CloudflareBlogPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  categories: readonly string[];
}

export class CloudflareBlogPlugin implements Plugin {
  readonly metadata = cloudflareBlogManifest;

  constructor(private readonly deps: CloudflareBlogPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "cloudflare-blog" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const headers = { "User-Agent": "FredyBot/1.0" };
    const res = await fetch(RSS_URL, { headers });
    if (!res.ok) {
      this.deps.logger.warn("source.fetch_error", { plugin: "cloudflare-blog", status: res.status });
      return [];
    }

    const xml = await res.text();
    const items = this.parseRSS(xml);

    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "cloudflare-blog",
      returned: items.length,
    });

    return items;
  }

  /** Simple RSS XML parser (no DOM dependency — Cloudflare Workers friendly). */
  private parseRSS(xml: string): readonly SourceItem[] {
    const items: SourceItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1] ?? "";
      const title = this.extractTag(block, "title");
      const link = this.extractTag(block, "link");
      const description = this.stripHtml(this.extractTag(block, "description"));
      const pubDate = this.extractTag(block, "pubDate");
      const categories = this.extractAllTags(block, "category");

      if (title && link) {
        items.push({
          id: `cf-blog-${link.slice(-60)}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title,
          body: description.slice(0, 1000),
          url: link,
          language: "en",
          publishedAt: pubDate ? Date.parse(pubDate) || undefined : undefined,
          metadata: {
            categories,
            pubDate,
          },
          fetchedAt: Date.now(),
        });
      }
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const match = regex.exec(xml);
    return (match?.[1] ?? match?.[2] ?? "").trim() ?? "";
  }

  private extractAllTags(xml: string, tag: string): readonly string[] {
    const results: string[] = [];
    const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      results.push((match[1] ?? match[2] ?? "").trim());
    }
    return results;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
  }

  normalize(raw: unknown): SourceItem {
    const item = raw as RSSItem;
    return {
      id: `cf-blog-${item.link.slice(-60)}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: item.title,
      body: this.stripHtml(item.description).slice(0, 1000),
      url: item.link,
      language: "en",
      publishedAt: item.pubDate ? Date.parse(item.pubDate) || undefined : undefined,
      metadata: { categories: item.categories },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("cloudflare.com");
  }

  /**
   * Per-provider quality filter (v11 Phase 2).
   * Prefer: Workers, AI, Security, Performance, Networking.
   * Ignore minor announcements.
   */
  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const categories = ((item.metadata as { categories?: readonly string[] })?.categories ?? []) as readonly string[];
    const titleLower = item.title.toLowerCase();
    const bodyLower = item.body.toLowerCase();

    const matchedTopics = PREFERRED_TOPICS.filter((topic) =>
      titleLower.includes(topic) ||
      bodyLower.includes(topic) ||
      categories.some((c) => c.toLowerCase().includes(topic)),
    );

    if (matchedTopics.length === 0) {
      return null; // Not a preferred topic
    }

    let score = 70;
    if (matchedTopics.length >= 3) score = 92;
    else if (matchedTopics.length >= 2) score = 85;
    else score = 78;

    return {
      item,
      score,
      reason: `topics=${matchedTopics.join(",")}`,
      boost: matchedTopics.includes("workers") || matchedTopics.includes("ai"),
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

export function createCloudflareBlogPlugin(deps: CloudflareBlogPluginDeps): CloudflareBlogPlugin {
  return new CloudflareBlogPlugin(deps);
}

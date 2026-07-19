/**
 * src/plugins/sources/openai-news/index.ts
 * OpenAI News RSS content source plugin — Tier B.
 *
 * Fetches and parses the OpenAI news RSS feed.
 * https://openai.com/news/rss.xml
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { openaiNewsManifest } from "./manifest";
export { openaiNewsManifest } from "./manifest";

const RSS_URL = "https://openai.com/news/rss.xml";
const CACHE_KEY = "fredy:source:openai-news:latest";
const CACHE_TTL_SECONDS = 12 * 3600; // 12 hours (Tier B)

export interface OpenAINewsPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class OpenAINewsPlugin implements Plugin {
  readonly metadata = openaiNewsManifest;

  constructor(private readonly deps: OpenAINewsPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "openai-news" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const headers = { "User-Agent": "FredyBot/1.0" };
    const res = await fetch(RSS_URL, { headers });
    if (!res.ok) {
      this.deps.logger.warn("source.fetch_error", { plugin: "openai-news", status: res.status });
      return [];
    }

    const xml = await res.text();
    const items = this.parseRSS(xml);

    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", { plugin: "openai-news", returned: items.length });
    return items;
  }

  private parseRSS(xml: string): readonly SourceItem[] {
    const items: SourceItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1] ?? "";
      const title = this.extractTag(block, "title");
      const link = this.extractTag(block, "link") || this.extractLink(block);
      const description = this.stripHtml(this.extractTag(block, "description"));
      const pubDate = this.extractTag(block, "pubDate");

      if (title && link) {
        items.push({
          id: `oai-${title.slice(0, 40).replace(/\s+/g, "-")}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title,
          body: description.slice(0, 1000),
          url: link,
          language: "en",
          publishedAt: pubDate ? Date.parse(pubDate) || undefined : undefined,
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

  private extractLink(xml: string): string {
    const match = /<link[^>]*href="([^"]+)"/.exec(xml);
    return match?.[1] ?? "";
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
  }

  normalize(raw: unknown): SourceItem {
    const item = raw as { title: string; link: string; description: string; pubDate: string };
    return {
      id: `oai-${item.title.slice(0, 40).replace(/\s+/g, "-")}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: item.title,
      body: this.stripHtml(item.description).slice(0, 1000),
      url: item.link,
      language: "en",
      publishedAt: item.pubDate ? Date.parse(item.pubDate) || undefined : undefined,
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("openai.com");
  }

  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    // OpenAI news is generally high-quality; accept all with a base score.
    // Boost if it mentions model releases.
    const text = (item.title + " " + item.body).toLowerCase();
    const isModelRelease = /gpt|model|release|launch|api/.test(text);

    let score = 80;
    if (isModelRelease) score = 92;

    return {
      item,
      score,
      reason: isModelRelease ? "model-release" : "standard",
      boost: isModelRelease,
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

export function createOpenAINewsPlugin(deps: OpenAINewsPluginDeps): OpenAINewsPlugin {
  return new OpenAINewsPlugin(deps);
}

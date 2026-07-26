/**
 * src/plugins/sources/anandtech/index.ts
 * v13.0.0: AnandTech RSS plugin — Tier H.
 *
 * One RSS item = one Strategy candidate. Only the latest article is published
 * per fetch. No daily summaries.
 *
 * RSS: https://www.anandtech.com/rss/
 */
import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { anandtechManifest } from "./manifest";
export { anandtechManifest } from "./manifest";

const RSS_URL = "https://feeds.feedburner.com/anandtech"; // v13.0.3: fixed — old /rss/ returned HTML
const CACHE_KEY = "fredy:source:anandtech:latest";
const CACHE_TTL_SECONDS = 4 * 3600; // 4 hours (Tier H)

export interface AnandtechPluginDeps {
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

export class AnandtechPlugin implements Plugin {
  readonly metadata = anandtechManifest;

  constructor(private readonly deps: AnandtechPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "anandtech" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const headers = { "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)" };
    const res = await fetch(RSS_URL, { headers });
    if (!res.ok) {
      this.deps.logger.warn("source.fetch_error", { plugin: "anandtech", status: res.status });
      return [];
    }

    const xml = await res.text();
    const items = this.parseRSS(xml);

    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", { plugin: "anandtech", returned: items.length });
    return items;
  }

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
          id: `at-${link.slice(-60)}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title,
          body: description.slice(0, 1000),
          url: link,
          language: "en",
          publishedAt: pubDate ? Date.parse(pubDate) || undefined : undefined,
          metadata: { categories, pubDate },
          displayIcon: this.metadata.displayIcon ?? "🔧",
          displaySource: this.metadata.displaySource ?? "AnandTech",
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
      id: `at-${item.link.slice(-60)}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: item.title,
      body: this.stripHtml(item.description).slice(0, 1000),
      url: item.link,
      language: "en",
      publishedAt: item.pubDate ? Date.parse(item.pubDate) || undefined : undefined,
      metadata: { categories: item.categories },
      displayIcon: this.metadata.displayIcon ?? "🔧",
      displaySource: this.metadata.displaySource ?? "AnandTech",
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && (item.url.includes("anandtech.com"));
  }

  /** v13.0.0: Quality filter — boost deep-dive analysis/reviews. */
  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const categories = ((item.metadata as { categories?: readonly string[] })?.categories ?? []) as readonly string[];
    const titleLower = item.title.toLowerCase();
    const bodyLower = item.body.toLowerCase();
    const PREFERRED = ["review", "analysis", "deep", "dive", "benchmark", "architecture", "test"];
    const matched = PREFERRED.filter((t) =>
      titleLower.includes(t) || bodyLower.includes(t) || categories.some((c) => c.toLowerCase().includes(t)),
    );
    if (matched.length === 0) return null;
    const score = matched.length >= 3 ? 92 : matched.length >= 2 ? 85 : 78;
    return { item, score, reason: `topics=${matched.join(",")}`, boost: matched.includes("analysis") || matched.includes("benchmark") };
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
      itemsAccepted: 0, itemsRejected: 0, averageLatencyMs: null,
      consecutiveEmptyFetches: 0, currentBackoffMultiplier: 1, lastRefreshAt: null,
    };
  }
}

export function createAnandtechPlugin(deps: AnandtechPluginDeps): AnandtechPlugin {
  return new AnandtechPlugin(deps);
}

/**
 * src/plugins/sources/techpowerup/index.ts
 * v13.0.4: TechPowerUp RSS plugin — Tier H.
 *
 * Replaces AnandTech (whose RSS only returned forum marketplace spam).
 * TechPowerUp has 111 RSS items with <enclosure> images — real hardware news.
 *
 * RSS: https://www.techpowerup.com/rss/news
 * Image extraction: <enclosure url="..."> tag (every item has one).
 */
import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { techpowerupManifest } from "./manifest";
export { techpowerupManifest } from "./manifest";

const RSS_URL = "https://www.techpowerup.com/rss/news";
const CACHE_KEY = "fredy:source:techpowerup:latest";
const CACHE_TTL_SECONDS = 4 * 3600; // 4 hours (Tier H)

export interface TechPowerUpPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  enclosure?: string;
  categories: readonly string[];
}

export class TechPowerUpPlugin implements Plugin {
  readonly metadata = techpowerupManifest;

  constructor(private readonly deps: TechPowerUpPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "techpowerup" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const headers = { "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)" };
    const res = await fetch(RSS_URL, { headers });
    if (!res.ok) {
      this.deps.logger.warn("source.fetch_error", { plugin: "techpowerup", status: res.status });
      return [];
    }

    const xml = await res.text();
    const items = this.parseRSS(xml);

    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", { plugin: "techpowerup", returned: items.length });
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

      // v13.0.4: Extract image from <enclosure url="..."> tag.
      // TechPowerUp includes an enclosure image on EVERY item.
      let imageUrl: string | undefined;
      const enclosureMatch = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(block);
      if (enclosureMatch?.[1]) {
        imageUrl = enclosureMatch[1];
      }

      if (title && link) {
        items.push({
          id: `tpu-${link.slice(-60)}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title,
          body: description.slice(0, 1000),
          url: link,
          imageUrl,
          language: "en",
          publishedAt: pubDate ? Date.parse(pubDate) || undefined : undefined,
          metadata: { categories, pubDate, enclosure: imageUrl },
          displayIcon: this.metadata.displayIcon ?? "⚡",
          displaySource: this.metadata.displaySource ?? "TechPowerUp",
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
      id: `tpu-${item.link.slice(-60)}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: item.title,
      body: this.stripHtml(item.description).slice(0, 1000),
      url: item.link,
      imageUrl: item.enclosure,
      language: "en",
      publishedAt: item.pubDate ? Date.parse(item.pubDate) || undefined : undefined,
      metadata: { categories: item.categories, enclosure: item.enclosure },
      displayIcon: this.metadata.displayIcon ?? "⚡",
      displaySource: this.metadata.displaySource ?? "TechPowerUp",
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && (item.url.includes("techpowerup.com"));
  }

  /** v13.0.4: Enhanced quality filter — only high-value hardware news passes.
   *  Rejects: marketplace listings, deals, minor updates, non-hardware content. */
  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const categories = ((item.metadata as { categories?: readonly string[] })?.categories ?? []) as readonly string[];
    const titleLower = item.title.toLowerCase();
    const bodyLower = item.body.toLowerCase();
    const text = `${titleLower} ${bodyLower}`;

    // POSITIVE: High-value hardware topics
    const POSITIVE = [
      "gpu", "cpu", "ram", "ssd", "review", "benchmark", "amd", "nvidia", "intel",
      "launch", "release", "performance", "rtx", "radeon", "ryzen", "core ultra",
      "motherboard", "psu", "cooler", "case", "display", "monitor", "vr",
      "ai chip", "ai accelerator", "datacenter", "server", "tsmc", "3nm", "2nm",
      "ddr5", "ddr6", "pcie gen5", "usb4", "thunderbolt",
    ];
    const matched = POSITIVE.filter((t) =>
      titleLower.includes(t) || bodyLower.includes(t) || categories.some((c) => c.toLowerCase().includes(t)),
    );
    if (matched.length === 0) return null; // Not hardware-related

    // NEGATIVE: Low-value content to reject
    const NEGATIVE = [
      "deal", "discount", "sale", "price drop", "coupon", "giveaway",
      "$", "shipped", "for sale", "buying", "selling",
      "wallpaper", "contest", "sweepstakes",
    ];
    const negativeMatched = NEGATIVE.filter((t) => text.includes(t));
    if (negativeMatched.length > 0) return null; // Marketplace/deal spam

    // Score based on number of positive matches
    let score = 70;
    if (matched.length >= 3) score = 92;
    else if (matched.length >= 2) score = 85;
    else score = 78;

    return {
      item,
      score,
      reason: `topics=${matched.join(",")}`,
      boost: matched.includes("gpu") || matched.includes("cpu") || matched.includes("rtx"),
    };
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

export function createTechPowerUpPlugin(deps: TechPowerUpPluginDeps): TechPowerUpPlugin {
  return new TechPowerUpPlugin(deps);
}

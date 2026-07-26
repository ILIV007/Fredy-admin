/**
 * src/plugins/sources/anandtech/index.ts
 * v13.0.4: DISABLED (legacy) — AnandTech RSS only returns forum marketplace spam.
 * Kept for potential future re-enablement if AnandTech restores article RSS.
 */
import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { anandtechManifest } from "./manifest";
export { anandtechManifest } from "./manifest";

const RSS_URL = "https://feeds.feedburner.com/anandtech";
const CACHE_KEY = "fredy:source:anandtech:latest";
const CACHE_TTL_SECONDS = 4 * 3600;

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
    if (!res.ok) { this.deps.logger.warn("source.fetch_error", { plugin: "anandtech", status: res.status }); return []; }
    const xml = await res.text();
    const items = this.parseRSS(xml);
    if (items.length > 0) { await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {}); }
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
      let imageUrl: string | undefined;
      const enclosureMatch = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(block);
      if (enclosureMatch?.[1]) imageUrl = enclosureMatch[1];
      const mediaContentMatch = /<media:content[^>]+url=["']([^"']+)["']/i.exec(block);
      if (!imageUrl && mediaContentMatch?.[1]) imageUrl = mediaContentMatch[1];
      if (title && link) {
        items.push({
          id: `at-${link.slice(-60)}`, source: this.metadata.id, category: this.metadata.category,
          title, body: description.slice(0, 1000), url: link, imageUrl, language: "en",
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
    while ((match = regex.exec(xml)) !== null) { results.push((match[1] ?? match[2] ?? "").trim()); }
    return results;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
  }

  normalize(raw: unknown): SourceItem {
    const item = raw as RSSItem;
    return {
      id: `at-${item.link.slice(-60)}`, source: this.metadata.id, category: this.metadata.category,
      title: item.title, body: this.stripHtml(item.description).slice(0, 1000), url: item.link,
      language: "en", publishedAt: item.pubDate ? Date.parse(item.pubDate) || undefined : undefined,
      metadata: { categories: item.categories },
      displayIcon: this.metadata.displayIcon ?? "🔧",
      displaySource: this.metadata.displaySource ?? "AnandTech",
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && (item.url.includes("anandtech.com"));
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id, healthy: false, enabled: this.metadata.enabled,
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

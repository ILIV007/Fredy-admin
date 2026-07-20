/**
 * src/plugins/sources/stackexchange/index.ts
 * Stack Exchange content source plugin.
 *
 * Fetches top questions from Stack Overflow.
 * Category A (programming, dev tips, best practices).
 *
 * StackExchange API requires a User-Agent header or may return 403.
 * See: https://api.stackexchange.com/docs
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { stackexchangeManifest } from "./manifest";
export { stackexchangeManifest } from "./manifest";

const SO_API = "https://api.stackexchange.com/2.3";
const CACHE_KEY = "fredy:source:stackexchange:top";
// v11.3.0: Reduced from 24h to 6h — 24h cache meant empty results persisted all day.
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours

// Programming tags to filter by (rotates for variety)
// v11.3.0: Added more popular tags to increase hit rate.
const TAG_SETS = [
  ["javascript"],
  ["typescript"],
  ["python"],
  ["rust"],
  ["go"],
  ["java"],
  ["react"],
  ["node.js"],
  ["docker"],
  ["git"],
  ["kubernetes"],
  ["aws"],
  ["vue.js"],
  ["angular"],
  ["sql"],
  ["regex"],
];

export interface StackExchangePluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface SOQuestion {
  question_id?: number;
  title?: string;
  body?: string;
  excerpt?: string;
  link?: string;
  score?: number;
  tags?: string[];
  is_answered?: boolean;
  creation_date?: number;
  owner?: { display_name?: string };
}

export class StackExchangePlugin implements Plugin {
  readonly metadata = stackexchangeManifest;

  constructor(private readonly deps: StackExchangePluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "stackexchange" });

    // Check cache first — but DON'T cache empty results (v11.3.0 fix).
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "stackexchange", count: cached.length });
      return cached;
    }

    // v11.5.0: Try API first, then RSS fallback.
    // StackExchange API throttles Cloudflare Workers IPs (400 throttle error).
    // RSS feeds are not throttled.
    const apiItems = await this.fetchAPI();
    if (apiItems.length > 0) return apiItems;

    // v11.5.0: RSS fallback — StackExchange has RSS feeds per tag.
    return this.fetchRSS();
  }

  /** v11.5.0: API fetch with multiple tag retry. */
  private async fetchAPI(): Promise<readonly SourceItem[]> {
    const shuffledTags = [...TAG_SETS].sort(() => Math.random() - 0.5);
    let items: readonly SourceItem[] = [];

    for (const tags of shuffledTags.slice(0, 3)) {
      const tagged = tags.join(";");

      const params = new URLSearchParams({
        order: "desc",
        sort: "votes",
        tagged,
        site: "stackoverflow",
        pagesize: "20",
        // v11.4.0: Use default filter (no custom filter param — custom filters
        // can cause 400 errors if they're invalid or expired).
      });

      const url = `${SO_API}/questions?${params.toString()}`;

      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
            "Accept": "application/json",
          },
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 400 && body.includes("throttle")) {
            this.deps.logger.warn("source.throttled", {
              plugin: "stackexchange",
              message: "StackExchange API throttled — trying next tag set",
            });
            continue;
          }
          this.deps.logger.warn("source.api_error", {
            plugin: "stackexchange", status: res.status, tags,
          });
          continue;
        }

        const data = await res.json() as { items?: SOQuestion[]; error_id?: number; error_message?: string };
        if (data.error_id) {
          this.deps.logger.warn("source.api_error", {
            plugin: "stackexchange", errorId: data.error_id, errorMessage: data.error_message,
          });
          continue;
        }

        const questions = data.items ?? [];

        // v11.3.0: Relaxed filter — score >= 1 (was > 1), is_answered optional.
        const filtered = questions
          .filter((q) => (q.score ?? 0) >= 1)
          .slice(0, 10);

        items = filtered.map((q) => this.normalize(q));

        if (items.length > 0) {
          this.deps.logger.info("source.fetch_success", {
            plugin: "stackexchange", tags, returned: items.length,
          });
          break; // Got results, stop trying more tags.
        }
      } catch (error) {
        this.deps.logger.warn("source.fetch_error", {
          plugin: "stackexchange", tags,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Cache the result (only if non-empty, v11.3.0).
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const q = raw as SOQuestion;
    // When no body is returned (default filter), build a fallback body from tags.
    const body = q.body ?? q.excerpt ?? (q.tags && q.tags.length > 0
      ? `Tags: ${q.tags.join(", ")}`
      : "");
    return {
      id: String(q.question_id ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(q.title ?? ""),
      body: String(body),
      url: String(q.link ?? ""),
      language: "en",
      publishedAt: q.creation_date ? q.creation_date * 1000 : undefined,
      metadata: {
        score: q.score,
        tags: q.tags,
        isAnswered: q.is_answered,
        author: q.owner?.display_name,
      },
            displayIcon: this.metadata.displayIcon ?? "🌌",
      displaySource: this.metadata.displaySource ?? "Source",
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && (item.url.includes("stackoverflow.com") || item.url.includes("stackexchange.com"));
  }

  /**
   * v11.5.0: RSS fallback when API is throttled.
   * StackExchange has RSS feeds: https://stackoverflow.com/feeds/tag/{tag}
   */
  private async fetchRSS(): Promise<readonly SourceItem[]> {
    const tags = TAG_SETS[Math.floor(Math.random() * TAG_SETS.length)] ?? ["javascript"];
    const tag = tags[0] ?? "javascript";
    const RSS_URL = `https://stackoverflow.com/feeds/tag/${encodeURIComponent(tag)}`;

    try {
      const res = await fetch(RSS_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FredyBot/1.0)" },
      });

      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", { plugin: "stackexchange", source: "rss", status: res.status, tag });
        return [];
      }

      const xml = await res.text();
      const items = this.parseRSS(xml, tag);

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
      }

      this.deps.logger.info("source.fetch_success", {
        plugin: "stackexchange", source: "rss", tag, returned: items.length,
      });
      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "stackexchange", source: "rss", tag,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** v11.5.0: Parse StackExchange Atom RSS feed. */
  private parseRSS(xml: string, tag: string): readonly SourceItem[] {
    const items: SourceItem[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1] ?? "";
      const title = this.extractTag(block, "title");
      const link = this.extractAtomLink(block);
      const summary = this.stripHtml(this.extractTag(block, "summary"));
      const published = this.extractTag(block, "published");
      const id = this.extractTag(block, "id");

      if (title && link) {
        items.push({
          id: `so-${id || title.slice(0, 30)}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title,
          body: summary.slice(0, 500) || title,
          url: link,
          language: "en",
          publishedAt: published ? Date.parse(published) || undefined : undefined,
          metadata: {
            tags: [tag],
            score: 0,
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

  private extractAtomLink(xml: string): string {
    const match = /<link[^>]*href="([^"]+)"[^>]*rel="alternate"/i.exec(xml)
      ?? /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i.exec(xml)
      ?? /<link[^>]*href="([^"]+)"/i.exec(xml);
    return match?.[1] ?? "";
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
      // v11 Phase 3: Provider Analytics
      itemsAccepted: 0,
      itemsRejected: 0,
      averageLatencyMs: null,
      consecutiveEmptyFetches: 0,
      currentBackoffMultiplier: 1,
      lastRefreshAt: null,
    };
  }
}

export function createStackExchangePlugin(deps: StackExchangePluginDeps): StackExchangePlugin {
  return new StackExchangePlugin(deps);
}

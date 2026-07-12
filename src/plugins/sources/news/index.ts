<<<<<<< HEAD
/**
 * src/plugins/sources/news/index.ts
 * NewsAPI content source plugin.
 *
 * Fetches technology news headlines from NewsAPI.org.
 * Category B (tech news only — no politics, no general news).
 * See FREDY_GUIDELINES.md §6.2.
 *
 * Requires NEWSAPI_KEY secret. Free tier: 100 req/day, 1 req/sec.
 * Caches results for 1 hour to conserve quota.
 */

=======
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { newsManifest } from "./manifest";
<<<<<<< HEAD

const NEWSAPI_URL = "https://newsapi.org/v2/top-headlines";
const CACHE_KEY = "fredy:source:news:tech";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

export interface NewsPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface NewsArticle {
  source?: { id?: string; name?: string };
  author?: string;
  title?: string;
  description?: string;
  url?: string;
  urlToImage?: string;
  publishedAt?: string;
  content?: string;
}

interface NewsAPIResponse {
  status?: string;
  code?: string;
  message?: string;
  totalResults?: number;
  articles?: NewsArticle[];
}

=======
export interface NewsPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
export class NewsPlugin implements Plugin {
  readonly metadata = newsManifest;
  constructor(private readonly deps: NewsPluginDeps) {}
<<<<<<< HEAD

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "news" });

    const apiKey = this.deps.env.NEWSAPI_KEY;
    if (!apiKey) {
      throw new Error("NewsAPI 401: NEWSAPI_KEY not set");
    }

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "news", count: cached.length });
      return cached;
    }

    // Build URL — Free tier requires `country` OR `category` OR `sources` parameter
    // For tech news, use category=technology
    const params = new URLSearchParams({
      category: "technology",
      language: "en",
      pageSize: "15",
      apiKey,
    });

    const url = `${NEWSAPI_URL}?${params.toString()}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json() as NewsAPIResponse;
        if (body.code && body.message) {
          detail = `${body.code}: ${body.message}`;
        }
      } catch { /* ignore JSON parse errors */ }
      throw new Error(`NewsAPI ${detail}`);
    }

    const data = await res.json() as NewsAPIResponse;

    if (data.status !== "ok") {
      throw new Error(`NewsAPI error: ${data.code ?? "unknown"} — ${data.message ?? "no message"}`);
    }

    const articles = data.articles ?? [];

    // Filter out: politics, opinion, [Removed] placeholders
    const filtered = articles.filter((a) => {
      const title = (a.title ?? "").toLowerCase();
      const desc = (a.description ?? "").toLowerCase();
      if (title === "[removed]") return false;
      if (title.includes("opinion:") || title.includes("politics:")) return false;
      if (desc.includes("opinion") && desc.length < 50) return false;
      return true;
    });

    const items = filtered.map((a) => this.normalize(a));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "news",
      totalArticles: articles.length,
      filtered: filtered.length,
      returned: items.length,
    });

    return items;
=======
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "news" });
    if (!this.deps.env.NEWSAPI_KEY) throw new Error("NEWSAPI_KEY not set");
    const r = await fetch(`https://newsapi.org/v2/top-headlines?category=technology&language=en&pageSize=10&apiKey=${this.deps.env.NEWSAPI_KEY}`, { headers: { "User-Agent": "Fredy-Bot/1.0" } });
    if (!r.ok) throw new Error(`NewsAPI ${r.status}`);
    const data = await r.json() as { articles?: Array<Record<string, unknown>> };
    return (data.articles ?? []).map(a => this.normalize(a));
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  normalize(raw: unknown): SourceItem {
<<<<<<< HEAD
    const article = raw as NewsArticle;
    return {
      id: String(article.url ?? "").slice(0, 100),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(article.title ?? ""),
      body: String(article.description ?? article.content ?? ""),
      url: String(article.url ?? ""),
      imageUrl: article.urlToImage ? String(article.urlToImage) : undefined,
      language: "en",
      publishedAt: article.publishedAt ? Date.parse(article.publishedAt) || undefined : undefined,
      metadata: {
        source: article.source?.name,
        author: article.author,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    if (!item.title || !item.url) return false;
    if (item.title.length < 10) return false;
    return true;
  }

  async health(): Promise<PluginStatus> {
    const hasKey = !!this.deps.env.NEWSAPI_KEY;
    return {
      pluginId: this.metadata.id,
      healthy: hasKey,
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: hasKey ? null : "NEWSAPI_KEY not set",
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastItemCount: null,
    };
=======
    const a = raw as Record<string, unknown>;
    return { id: String(a["url"] ?? "").slice(0,100), source: this.metadata.id, category: this.metadata.category, title: String(a["title"] ?? ""), body: String(a["description"] ?? a["content"] ?? ""), url: String(a["url"] ?? ""), language: "en", publishedAt: a["publishedAt"] ? Date.parse(String(a["publishedAt"])) : undefined, imageUrl: a["urlToImage"] ? String(a["urlToImage"]) : undefined, metadata: { author: a["author"] }, fetchedAt: Date.now() };
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url && item.title.length > 10; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: !!this.deps.env.NEWSAPI_KEY, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: this.deps.env.NEWSAPI_KEY ? null : "NEWSAPI_KEY not set", consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createNewsPlugin(deps: NewsPluginDeps): NewsPlugin { return new NewsPlugin(deps); }

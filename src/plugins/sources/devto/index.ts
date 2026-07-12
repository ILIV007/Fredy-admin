<<<<<<< HEAD
/**
 * src/plugins/sources/devto/index.ts
 * Dev.to content source plugin.
 *
 * Fetches top articles from Dev.to developer community.
 * Category A (developer content, tutorials).
 *
 * Dev.to API: https://developers.forem.com/api
 * GET https://dev.to/api/articles?per_page=10&top=7
 *
 * NOTE: Dev.to API requires a proper User-Agent. Empty UA gets 403.
 */

=======
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { devtoManifest } from "./manifest";
<<<<<<< HEAD

const DEVTO_API = "https://dev.to/api/articles";
const CACHE_KEY = "fredy:source:devto:top";
const CACHE_TTL_SECONDS = 2 * 3600; // 2 hours

export interface DevToPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface DevToArticle {
  id?: number;
  title?: string;
  description?: string;
  url?: string;
  cover_image?: string | null;
  social_image?: string | null;
  published_at?: string;
  reading_time_minutes?: number;
  tags?: string[];
  user?: { name?: string; username?: string };
}

=======
export interface DevToPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
export class DevToPlugin implements Plugin {
  readonly metadata = devtoManifest;
  constructor(private readonly deps: DevToPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "devto" });
<<<<<<< HEAD

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "devto", count: cached.length });
      return cached;
    }

    // Build URL — top articles from the last 7 days
    const params = new URLSearchParams({
      per_page: "15",
      top: "7",
    });

    const url = `${DEVTO_API}?${params.toString()}`;

    // Dev.to REQUIRES a real User-Agent or returns 403
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Dev.to API ${res.status}: ${res.statusText}`);
    }

    const articles = await res.json() as DevToArticle[];

    // Filter: must have title and url
    const filtered = articles.filter((a) => a.title && a.url);

    const items = filtered.map((a) => this.normalize(a));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "devto",
      totalArticles: articles.length,
      returned: items.length,
    });

    return items;
=======
    const r = await fetch("https://dev.to/api/articles?top=7&per_page=10", { headers: { "User-Agent": "Fredy-Bot/1.0", "Accept": "application/json" } });
    if (!r.ok) throw new Error(`Dev.to ${r.status}`);
    const data = await r.json() as Array<Record<string, unknown>>;
    return data.map(a => this.normalize(a));
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  normalize(raw: unknown): SourceItem {
<<<<<<< HEAD
    const article = raw as DevToArticle;
    const imageUrl = article.cover_image ?? article.social_image ?? undefined;
    return {
      id: `devto-${article.id ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(article.title ?? ""),
      body: String(article.description ?? ""),
      url: String(article.url ?? ""),
      imageUrl: imageUrl ?? undefined,
      language: "en",
      publishedAt: article.published_at ? Date.parse(article.published_at) || undefined : undefined,
      metadata: {
        author: article.user?.name ?? article.user?.username,
        readingTime: article.reading_time_minutes,
        tags: article.tags,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("dev.to");
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
=======
    const a = raw as Record<string, unknown>;
    return { id: String(a["id"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: String(a["title"] ?? ""), body: String(a["description"] ?? ""), url: String(a["url"] ?? ""), language: "en", publishedAt: a["published_at"] ? Date.parse(String(a["published_at"])) : undefined, imageUrl: a["cover_image"] ? String(a["cover_image"]) : undefined, metadata: { tags: a["tag_list"], reactions: a["positive_reactions_count"] }, fetchedAt: Date.now() };
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createDevToPlugin(deps: DevToPluginDeps): DevToPlugin { return new DevToPlugin(deps); }

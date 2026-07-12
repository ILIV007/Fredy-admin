import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { xkcdManifest } from "./manifest";
<<<<<<< HEAD

const XKCD_API = "https://xkcd.com/info.json";
const CACHE_KEY = "fredy:source:xkcd:latest";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

export interface XkcdPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface XkcdComic {
  num: number;
  title: string;
  img: string;
  alt: string;
  day: string;
  month: string;
  year: string;
}

=======
export interface XkcdPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
export class XkcdPlugin implements Plugin {
  readonly metadata = xkcdManifest;
  constructor(private readonly deps: XkcdPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "xkcd" });
<<<<<<< HEAD

    // Check cache first
    const cached = await this.deps.kv.getJson<SourceItem>(CACHE_KEY).catch(() => null);
    if (cached) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "xkcd", id: cached.id });
      return [cached];
    }

    // Fetch fresh comic
    const res = await fetch(XKCD_API, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`XKCD API ${res.status}: ${res.statusText}`);
    }

    const comic = await res.json() as XkcdComic;
    const item = this.normalize(comic);

    // Cache the result
    await this.deps.kv.setJson(CACHE_KEY, item, CACHE_TTL_SECONDS).catch(() => {});

    return [item];
=======
    const r = await fetch("https://xkcd.com/info.json", { headers: { "User-Agent": "Fredy-Bot/1.0" } });
    if (!r.ok) throw new Error(`XKCD ${r.status}`);
    const data = await r.json() as Record<string, unknown>;
    return [this.normalize(data)];
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  normalize(raw: unknown): SourceItem {
<<<<<<< HEAD
    const comic = raw as XkcdComic;
    return {
      id: `xkcd-${comic.num}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: comic.title || `XKCD #${comic.num}`,
      body: comic.alt || "",
      url: `https://xkcd.com/${comic.num}/`,
      language: "en",
      publishedAt: this.parseDate(comic.year, comic.month, comic.day),
      imageUrl: comic.img || undefined,
      media: comic.img ? {
        type: "image",
        url: comic.img,
        alt: comic.alt || "",
        source: "provider",
      } : undefined,
      metadata: { num: comic.num, alt: comic.alt },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.imageUrl;
  }

  private parseDate(year: string | undefined, month: string | undefined, day: string | undefined): number | undefined {
    if (!year || !month || !day) return undefined;
    const padded = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const t = Date.parse(padded);
    return Number.isNaN(t) ? undefined : t;
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
    const c = raw as Record<string, unknown>;
    const num = c["num"]; const img = String(c["img"] ?? "");
    return { id: `xkcd-${num ?? ""}`, source: this.metadata.id, category: this.metadata.category, title: String(c["title"] ?? `XKCD #${num ?? ""}`), body: String(c["alt"] ?? ""), url: `https://xkcd.com/${num ?? ""}/`, language: "en", imageUrl: img, media: { type: "image", url: img, alt: String(c["alt"] ?? ""), source: "provider" }, metadata: { num }, fetchedAt: Date.now() };
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.imageUrl; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createXkcdPlugin(deps: XkcdPluginDeps): XkcdPlugin { return new XkcdPlugin(deps); }

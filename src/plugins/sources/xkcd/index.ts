/**
 * src/plugins/sources/xkcd/index.ts
 * XKCD content source plugin.
 *
 * Fetches the latest XKCD comic.
 * Category C (developer humor / dev facts).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { xkcdManifest } from "./manifest";

const XKCD_API = "https://xkcd.com/info.json";

export interface XkcdPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class XkcdPlugin implements Plugin {
  readonly metadata = xkcdManifest;

  constructor(private readonly deps: XkcdPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "xkcd" });
    // TODO: implement real fetch.
    // GET https://xkcd.com/info.json
    // Returns: { num, title, img, alt, day, month, year }
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const comic = raw as Record<string, unknown>;
    return {
      id: `xkcd-${comic["num"] ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(comic["title"] ?? `XKCD #${comic["num"] ?? ""}`),
      body: String(comic["alt"] ?? ""),
      url: `https://xkcd.com/${comic["num"] ?? ""}/`,
      language: "en",
      publishedAt: this.parseDate(comic["year"], comic["month"], comic["day"]),
      imageUrl: comic["img"] ? String(comic["img"]) : undefined,
      media: comic["img"] ? {
        type: "image",
        url: String(comic["img"]),
        alt: String(comic["alt"] ?? ""),
        source: "provider",
      } : undefined,
      metadata: { num: comic["num"], alt: comic["alt"] },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.imageUrl;
  }

  private parseDate(year: unknown, month: unknown, day: unknown): number | undefined {
    if (!year || !month || !day) return undefined;
    return Date.parse(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
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

export function createXkcdPlugin(deps: XkcdPluginDeps): XkcdPlugin {
  return new XkcdPlugin(deps);
}

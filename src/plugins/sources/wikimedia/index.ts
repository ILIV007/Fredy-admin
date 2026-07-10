/**
 * src/plugins/sources/wikimedia/index.ts
 * Wikimedia "Today in History" content source plugin.
 *
 * Fetches "On This Day" events from Wikipedia REST API.
 * Category C (today in tech history / dev facts).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { wikimediaManifest } from "./manifest";

const WIKI_API = "https://en.wikipedia.org/api/rest_v1/feed/onthisday/events";

export interface WikimediaPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class WikimediaPlugin implements Plugin {
  readonly metadata = wikimediaManifest;

  constructor(private readonly deps: WikimediaPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "wikimedia" });
    // TODO: implement real fetch.
    // GET /feed/onthisday/events/MM/DD
    // Filter: tech-related (pages with categories matching "software", "computing", "internet")
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const event = raw as Record<string, unknown>;
    const pages = event["pages"] as Array<Record<string, unknown>> | undefined;
    const firstPage = pages?.[0];
    return {
      id: String(event["text"] ?? "").slice(0, 100),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(event["text"] ?? "Today in History"),
      body: String(firstPage?.["extract"] ?? event["text"] ?? ""),
      url: String(firstPage?.["content_urls"]?.["desktop"]?.["page"] ?? "https://en.wikipedia.org"),
      language: "en",
      publishedAt: undefined, // historical event
      imageUrl: firstPage?.["thumbnail"]?.["source"] ? String(firstPage["thumbnail"]["source"]) : undefined,
      metadata: { year: event["year"], pages: pages?.length ?? 0 },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && item.title.length > 10;
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

export function createWikimediaPlugin(deps: WikimediaPluginDeps): WikimediaPlugin {
  return new WikimediaPlugin(deps);
}

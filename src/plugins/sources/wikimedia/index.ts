/**
 * src/plugins/sources/wikimedia/index.ts
 * Wikimedia "Today in History" content source plugin.
 *
 * Fetches "On This Day" events from Wikipedia REST API.
 * Category C (today in tech history / dev facts).
 *
 * Wikipedia REST API requires a proper User-Agent header or it returns 403.
 * See: https://meta.wikimedia.org/wiki/User-Agent_policy
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { wikimediaManifest } from "./manifest";
export { wikimediaManifest } from "./manifest";

const WIKI_API_BASE = "https://en.wikipedia.org/api/rest_v1/feed/onthisday/events";
const CACHE_KEY = "fredy:source:wikimedia:today";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours

// Tech-related keyword filters (matched against page title/categories)
const TECH_KEYWORDS = [
  "computer", "software", "programming", "internet", "web", "technology",
  "algorithm", "data", "digital", "electronic", "engineer", "science",
  "mathematic", "physics", "robot", "automation", "cyber", "network",
  "microprocessor", "transistor", "linux", "unix", "microsoft", "apple",
  "google", "ibm", "intel", "nasa", "space", "satellite", "ai ", "artificial intelligence",
];

export interface WikimediaPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface WikiPage {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string };
  categories?: Array<{ title?: string }>;
}

interface WikiEvent {
  text?: string;
  year?: number;
  pages?: WikiPage[];
}

export class WikimediaPlugin implements Plugin {
  readonly metadata = wikimediaManifest;

  constructor(private readonly deps: WikimediaPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "wikimedia" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "wikimedia", count: cached.length });
      return cached;
    }

    // Build URL with current month/day
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const url = `${WIKI_API_BASE}/${month}/${day}`;

    // Wikipedia REQUIRES a descriptive User-Agent or returns 403
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; contact@ilivir3.example) Cloudflare-Workers",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Wikimedia API ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as { events?: WikiEvent[] };
    const events = data.events ?? [];

    // Filter to tech-related events
    const techEvents = events.filter((e) => this.isTechRelated(e));

    // Normalize and limit to 5 items
    const items = techEvents.slice(0, 5).map((e) => this.normalize(e));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "wikimedia",
      totalEvents: events.length,
      techEvents: techEvents.length,
      returned: items.length,
    });

    return items;
  }

  private isTechRelated(event: WikiEvent): boolean {
    const text = (event.text ?? "").toLowerCase();
    const pageTitles = (event.pages ?? []).map((p) => (p.title ?? "").toLowerCase()).join(" ");
    const pageCategories = (event.pages ?? []).flatMap((p) => p.categories ?? []).map((c) => (c.title ?? "").toLowerCase()).join(" ");
    const combined = `${text} ${pageTitles} ${pageCategories}`;
    return TECH_KEYWORDS.some((kw) => combined.includes(kw));
  }

  normalize(raw: unknown): SourceItem {
    const event = raw as WikiEvent;
    const pages = event.pages ?? [];
    const firstPage = pages[0];
    return {
      id: String(event.text ?? "").slice(0, 100),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(event.text ?? "Today in History"),
      body: String(firstPage?.extract ?? event.text ?? ""),
      url: String(firstPage?.content_urls?.desktop?.page ?? "https://en.wikipedia.org"),
      language: "en",
      publishedAt: undefined, // historical event
      imageUrl: firstPage?.thumbnail?.source ? String(firstPage.thumbnail.source) : undefined,
      metadata: { year: event.year, pages: pages.length },
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

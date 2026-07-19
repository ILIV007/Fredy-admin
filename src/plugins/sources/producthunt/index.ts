/**
 * src/plugins/sources/producthunt/index.ts
 * Product Hunt content source plugin — Tier A.
 *
 * Fetches top products. Falls back to RSS-style scraping if no API key.
 * Quality filter (v11 Phase 2): categories Developer Tools, AI, Open Source.
 *
 * Note: Product Hunt API requires an API token. If PRODUCTHUNT_TOKEN is not set,
 * the plugin returns empty (health check will show healthy: false).
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { producthuntManifest } from "./manifest";
export { producthuntManifest } from "./manifest";

const API_URL = "https://api.producthunt.com/v2/api/graphql";
const CACHE_KEY = "fredy:source:producthunt:top";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours (Tier A)

const PREFERRED_TOPICS = ["developer tools", "ai", "open source", "developer", "api", "sdk", "framework"];

export interface ProductHuntPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface PHProduct {
  node: {
    id: string;
    name: string;
    tagline: string;
    url: string;
    website?: string;
    votesCount?: number;
    createdAt?: string;
    topics?: { edges: readonly { node: { name: string } }[] };
  };
}

export class ProductHuntPlugin implements Plugin {
  readonly metadata = producthuntManifest;

  constructor(private readonly deps: ProductHuntPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "producthunt" });

    // ProductHunt requires a token — if not set, return empty
    const token = (this.deps.env as unknown as Record<string, string | undefined>).PRODUCTHUNT_TOKEN;
    if (!token) {
      this.deps.logger.warn("source.fetch_no_token", { plugin: "producthunt" });
      return [];
    }

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const query = `
      query {
        posts(first: 10, order: VOTES) {
          edges {
            node {
              id
              name
              tagline
              url
              website
              votesCount
              createdAt
              topics(first: 5) {
                edges { node { name } }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "FredyBot/1.0",
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", { plugin: "producthunt", status: res.status });
        return [];
      }

      const data = await res.json() as { data?: { posts?: { edges: readonly PHProduct[] } } };
      const products = data.data?.posts?.edges ?? [];

      const items = products.map((p) => this.normalize(p.node)).slice(0, 10);

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
      }

      this.deps.logger.info("source.fetch_success", { plugin: "producthunt", returned: items.length });
      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "producthunt",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  normalize(raw: unknown): SourceItem {
    const p = raw as PHProduct["node"];
    const topics = p.topics?.edges?.map((e) => e.node.name) ?? [];

    return {
      id: `ph-${p.id}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: p.name,
      body: p.tagline,
      url: p.website ?? p.url,
      language: "en",
      publishedAt: p.createdAt ? Date.parse(p.createdAt) || undefined : undefined,
      metadata: {
        votes: p.votesCount ?? 0,
        topics,
        producthuntUrl: p.url,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url;
  }

  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const meta = item.metadata as { votes?: number; topics?: readonly string[] };
    const votes = meta.votes ?? 0;
    const topics = (meta.topics ?? []).map((t) => t.toLowerCase());

    const text = (item.title + " " + item.body).toLowerCase();
    const matched = PREFERRED_TOPICS.filter((t) =>
      text.includes(t) || topics.some((topic) => topic.includes(t)),
    );

    if (matched.length === 0) return null;

    let score = 70;
    if (votes >= 500) score = 95;
    else if (votes >= 200) score = 85;
    else if (votes >= 50) score = 78;

    return {
      item,
      score,
      reason: `votes=${votes}, topics=${matched.join(",")}`,
      boost: votes >= 500,
    };
  }

  async health(): Promise<PluginStatus> {
    const token = (this.deps.env as unknown as Record<string, string | undefined>).PRODUCTHUNT_TOKEN;
    return {
      pluginId: this.metadata.id,
      healthy: !!token,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
      itemsAccepted: 0, itemsRejected: 0, averageLatencyMs: null,
      consecutiveEmptyFetches: 0, currentBackoffMultiplier: 1, lastRefreshAt: null,
    };
  }
}

export function createProductHuntPlugin(deps: ProductHuntPluginDeps): ProductHuntPlugin {
  return new ProductHuntPlugin(deps);
}

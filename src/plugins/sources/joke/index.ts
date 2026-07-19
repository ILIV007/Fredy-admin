/**
 * src/plugins/sources/joke/index.ts
 * JokeAPI content source plugin.
 *
 * Fetches programming jokes from JokeAPI v2.
 * Category C (developer humor).
 *
 * GET https://v2.jokeapi.dev/joke/Programming?safe-mode=true&type=twopart&amount=5
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { jokeManifest } from "./manifest";
export { jokeManifest } from "./manifest";

const JOKE_API = "https://v2.jokeapi.dev/joke/Programming";
const CACHE_KEY = "fredy:source:joke:batch";
const CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

export interface JokePluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface JokeAPIResponse {
  error?: boolean;
  category?: string;
  type?: string;
  joke?: string;           // single joke
  setup?: string;          // twopart
  delivery?: string;       // twopart
  flags?: { nsfw?: boolean; religious?: boolean; political?: boolean; racist?: boolean; sexist?: boolean; explicit?: boolean };
  id?: number;
  amount?: number;
  jokes?: Array<JokeAPIResponse>; // when amount > 1
}

export class JokePlugin implements Plugin {
  readonly metadata = jokeManifest;

  constructor(private readonly deps: JokePluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "joke" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "joke", count: cached.length });
      return cached;
    }

    const params = new URLSearchParams({
      "safe-mode": "true",
      type: "twopart",
      amount: "5",
    });

    const url = `${JOKE_API}?${params.toString()}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "FredyBot/1.0 (Cloudflare Workers)", "Accept": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`JokeAPI ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as JokeAPIResponse;

    if (data.error) {
      throw new Error("JokeAPI returned error response");
    }

    // Normalize to array
    const jokes = data.jokes ?? [data];
    const items = jokes.map((j) => this.normalize(j));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "joke",
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const joke = raw as JokeAPIResponse;
    const setup = joke.setup ?? "";
    const delivery = joke.delivery ?? "";
    const single = joke.joke ?? "";
    const body = setup && delivery ? `${setup}\n\n${delivery}` : single;
    const title = setup ? setup.slice(0, 80) : "Programming Joke";
    return {
      id: `joke-${joke.id ?? Date.now()}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title,
      body,
      url: "https://v2.jokeapi.dev",
      language: "en",
      publishedAt: Date.now(),
      metadata: {
        category: joke.category,
        type: joke.type,
        id: joke.id,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.body && item.body.length > 10;
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

export function createJokePlugin(deps: JokePluginDeps): JokePlugin {
  return new JokePlugin(deps);
}

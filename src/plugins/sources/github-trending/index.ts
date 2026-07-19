/**
 * src/plugins/sources/github-trending/index.ts
 * GitHub Trending content source plugin.
 *
 * Fetches trending GitHub repositories using the GitHub search API
 * as a substitute for the unofficial /trending endpoint.
 * Category C (open source spotlight).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubTrendingManifest } from "./manifest";
export { githubTrendingManifest } from "./manifest";

const GH_API = "https://api.github.com";
const CACHE_KEY = "fredy:source:github-trending:daily";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours

export interface GitHubTrendingPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface GHRepo {
  id?: number;
  name?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  topics?: string[];
  created_at?: string;
  owner?: { login?: string; avatar_url?: string };
}

export class GitHubTrendingPlugin implements Plugin {
  readonly metadata = githubTrendingManifest;

  constructor(private readonly deps: GitHubTrendingPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-trending" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "github-trending", count: cached.length });
      return cached;
    }

    // Trending = repos created in last 7 days, sorted by stars
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split("T")[0]!;

    const params = new URLSearchParams({
      q: `stars:>100 created:>${weekAgo}`,
      sort: "stars",
      order: "desc",
      per_page: "10",
    });

    const url = `${GH_API}/search/repositories?${params.toString()}`;

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy)",
      "Accept": "application/vnd.github+json",
    };

    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`GitHub Trending API ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as { items?: GHRepo[]; total_count?: number };
    const repos = data.items ?? [];

    const items = repos.map((r) => this.normalize(r));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "github-trending",
      totalRepos: repos.length,
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const repo = raw as GHRepo;
    const ownerAvatar = repo.owner?.avatar_url ?? undefined;
    return {
      id: `trend-${repo.id ?? repo.full_name ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(repo.full_name ?? repo.name ?? ""),
      body: String(repo.description ?? ""),
      url: String(repo.html_url ?? ""),
      imageUrl: ownerAvatar,
      language: "en",
      publishedAt: repo.created_at ? Date.parse(repo.created_at) || undefined : undefined,
      metadata: {
        stars: repo.stargazers_count,
        language: repo.language,
        topics: repo.topics,
        owner: repo.owner?.login,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("github.com");
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

export function createGitHubTrendingPlugin(deps: GitHubTrendingPluginDeps): GitHubTrendingPlugin {
  return new GitHubTrendingPlugin(deps);
}

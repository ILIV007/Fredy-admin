/**
 * src/plugins/sources/github-trending/index.ts
 * GitHub Trending content source plugin (open source spotlight).
 *
 * Fetches trending repos created in the last 7 days, sorted by stars.
 * Category C (open source spotlight / tool of the day).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubTrendingManifest } from "./manifest";

const GH_API = "https://api.github.com/search/repositories";

export interface GitHubTrendingPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class GitHubTrendingPlugin implements Plugin {
  readonly metadata = githubTrendingManifest;

  constructor(private readonly deps: GitHubTrendingPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-trending" });
    // TODO: implement real fetch.
    // GET /search/repositories?q=created:>YYYY-MM-DD&sort=stars&order=desc&per_page=10
    // Filter: stars > 100, has description
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const repo = raw as Record<string, unknown>;
    return {
      id: String(repo["full_name"] ?? repo["id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(repo["full_name"] ?? repo["name"] ?? ""),
      body: String(repo["description"] ?? ""),
      url: String(repo["html_url"] ?? ""),
      language: "en",
      publishedAt: repo["created_at"] ? Date.parse(String(repo["created_at"])) : undefined,
      metadata: { stars: repo["stargazers_count"], language: repo["language"], topics: repo["topics"] },
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
    };
  }
}

export function createGitHubTrendingPlugin(deps: GitHubTrendingPluginDeps): GitHubTrendingPlugin {
  return new GitHubTrendingPlugin(deps);
}

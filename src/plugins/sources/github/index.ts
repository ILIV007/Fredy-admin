/**
 * src/plugins/sources/github/index.ts
 * GitHub content source plugin — REAL implementation.
 * Fetches trending repos from GitHub Search API.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubManifest } from "./manifest";

const GH_API = "https://api.github.com";

export interface GitHubPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class GitHubPlugin implements Plugin {
  readonly metadata = githubManifest;

  constructor(private readonly deps: GitHubPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github" });
    
    // Search for repos created in the last 7 days, sorted by stars.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const url = `${GH_API}/search/repositories?q=created:>${sevenDaysAgo}+stars:>50&sort=stars&order=desc&per_page=10`;
    
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Fredy-Bot",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${this.deps.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = await response.json() as { items?: Array<Record<string, unknown>> };
    const repos = data.items ?? [];

    return repos.map((repo) => this.normalize(repo));
  }

  normalize(raw: unknown): SourceItem {
    const repo = raw as Record<string, unknown>;
    const fullName = String(repo["full_name"] ?? "");
    return {
      id: fullName || String(repo["id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: fullName,
      body: String(repo["description"] ?? ""),
      url: String(repo["html_url"] ?? `https://github.com/${fullName}`),
      language: "en",
      publishedAt: repo["created_at"] ? Date.parse(String(repo["created_at"])) : undefined,
      metadata: {
        stars: repo["stargazers_count"],
        forks: repo["forks_count"],
        language: repo["language"],
        topics: repo["topics"],
        updatedAt: repo["updated_at"],
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    if (!item.id || !item.title || !item.url) return false;
    return item.url.startsWith("https://github.com/");
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

export function createGitHubPlugin(deps: GitHubPluginDeps): GitHubPlugin {
  return new GitHubPlugin(deps);
}

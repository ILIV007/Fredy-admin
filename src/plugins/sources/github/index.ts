/**
 * src/plugins/sources/github/index.ts
 * GitHub content source plugin.
 *
 * Fetches trending repositories from the GitHub Search API.
 * Category A (dev content: programming, AI, GitHub, dev tools).
 * See FREDY_GUIDELINES.md §6.1.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubManifest } from "./manifest";

export interface GitHubPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class GitHubPlugin implements Plugin {
  readonly metadata = githubManifest;

  constructor(private readonly deps: GitHubPluginDeps) {}

  getSource(): string {
    return this.metadata.id;
  }

  getCategory(): Category {
    return this.metadata.category;
  }

  supportsMedia(): boolean {
    return this.metadata.supportsImages;
  }

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Prompt 7 (Content Engine) — call
    // GET https://api.github.com/search/repositories?q=created:>YYYY-MM-DD&sort=stars
    // Use GITHUB_TOKEN if available for higher rate limit.
    // Cache results in KV (fredy:source:github:cache) for 30 min.
    this.deps.logger.info("source.fetch_start", { plugin: "github" });
    return [];
  }

  normalize(raw: unknown): SourceItem {
    // TODO: implement in Prompt 7 — convert GitHub API response to SourceItem.
    const repo = raw as Record<string, unknown>;
    return {
      id: String(repo["id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(repo["full_name"] ?? repo["name"] ?? ""),
      body: String(repo["description"] ?? ""),
      url: String(repo["html_url"] ?? ""),
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    if (!item.id || !item.title || !item.url) return false;
    if (!item.url.startsWith("https://github.com/")) return false;
    return true;
  }

  async health(): Promise<PluginStatus> {
    // TODO: implement in Prompt 7 — check rate-limit headers from last response.
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastItemCount: null,
    };
  }
}

/** Factory function for the PluginManager. */
export function createGitHubPlugin(deps: GitHubPluginDeps): GitHubPlugin {
  return new GitHubPlugin(deps);
}

/** Re-export the manifest for the barrel. */
export { githubManifest } from "./manifest";

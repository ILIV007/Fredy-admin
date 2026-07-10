/**
 * src/plugins/sources/github-releases/index.ts
 * GitHub Releases content source plugin.
 *
 * Fetches latest releases from a curated list of popular repos.
 * Category A (dev tools, frameworks, open source).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubReleasesManifest } from "./manifest";

const GH_API = "https://api.github.com";

/** Curated list of popular repos to watch for releases. */
const WATCHED_REPOS = [
  "microsoft/vscode",
  "facebook/react",
  "vercel/next.js",
  "rust-lang/rust",
  "golang/go",
  "nodejs/node",
  "denoland/deno",
  "oven-sh/bun",
];

export interface GitHubReleasesPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class GitHubReleasesPlugin implements Plugin {
  readonly metadata = githubReleasesManifest;

  constructor(private readonly deps: GitHubReleasesPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-releases" });
    // TODO: implement real fetch.
    // For each repo in WATCHED_REPOS:
    //   GET /repos/<repo>/releases/latest
    //   Filter: not draft, not prerelease
    void WATCHED_REPOS;
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const release = raw as Record<string, unknown>;
    const repo = (release["html_url"] as string ?? "").match(/github\.com\/([^/]+\/[^/]+)\//);
    return {
      id: String(release["id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: `${repo?.[1] ?? "repo"} ${release["tag_name"] ?? ""}`,
      body: String(release["body"] ?? release["name"] ?? ""),
      url: String(release["html_url"] ?? ""),
      language: "en",
      publishedAt: release["published_at"] ? Date.parse(String(release["published_at"])) : undefined,
      metadata: { tagName: release["tag_name"], prerelease: release["prerelease"], repo: repo?.[1] },
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

export function createGitHubReleasesPlugin(deps: GitHubReleasesPluginDeps): GitHubReleasesPlugin {
  return new GitHubReleasesPlugin(deps);
}

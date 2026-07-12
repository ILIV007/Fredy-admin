/**
 * src/plugins/sources/github-releases/index.ts
 * GitHub Releases content source plugin.
 *
 * Fetches latest releases from popular open-source repositories.
 * Category A (developer content, releases).
 *
 * Polls releases from a curated list of popular repos.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubReleasesManifest } from "./manifest";

const GH_API = "https://api.github.com";
const CACHE_KEY = "fredy:source:github-releases:latest";
const CACHE_TTL_SECONDS = 4 * 3600; // 4 hours

// Curated list of popular repos to monitor for releases
const WATCHED_REPOS = [
  "microsoft/vscode",
  "vercel/next.js",
  "facebook/react",
  "rust-lang/rust",
  "golang/go",
  "nodejs/node",
  "python/cpython",
  "microsoft/TypeScript",
  "tailwindlabs/tailwindcss",
  "prisma/prisma",
  "cloudflare/workers-sdk",
  "denoland/deno",
  "oven-sh/bun",
  "astral-sh/uv",
  "withastro/astro",
];

export interface GitHubReleasesPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface GHRelease {
  id?: number;
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  author?: { login?: string };
  repo?: string;
}

export class GitHubReleasesPlugin implements Plugin {
  readonly metadata = githubReleasesManifest;

  constructor(private readonly deps: GitHubReleasesPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-releases" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "github-releases", count: cached.length });
      return cached;
    }

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy)",
      "Accept": "application/vnd.github+json",
    };

    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    // Pick 5 random repos to query (to avoid rate limits)
    const shuffled = [...WATCHED_REPOS].sort(() => Math.random() - 0.5).slice(0, 5);

    const allReleases: GHRelease[] = [];

    for (const repo of shuffled) {
      try {
        const url = `${GH_API}/repos/${repo}/releases/latest`;
        const res = await fetch(url, { headers });

        if (!res.ok) {
          if (res.status === 404) continue; // No releases yet
          this.deps.logger.warn("source.fetch_repo_error", { plugin: "github-releases", repo, status: res.status });
          continue;
        }

        const release = await res.json() as GHRelease;
        release.repo = repo;
        allReleases.push(release);
      } catch (error) {
        this.deps.logger.warn("source.fetch_repo_error", {
          plugin: "github-releases",
          repo,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Filter: must have tag_name and html_url, skip drafts/prereleases
    const filtered = allReleases.filter((r) =>
      r.tag_name && r.html_url && !r.draft && !r.prerelease,
    );

    const items = filtered.map((r) => this.normalize(r));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "github-releases",
      reposChecked: shuffled.length,
      releasesFound: allReleases.length,
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const release = raw as GHRelease;
    return {
      id: `rel-${release.repo ?? "unknown"}-${release.tag_name ?? ""}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: `${release.repo ?? ""} ${release.tag_name ?? ""}`.trim(),
      body: String(release.body ?? release.name ?? "").slice(0, 1000),
      url: String(release.html_url ?? ""),
      language: "en",
      publishedAt: release.published_at ? Date.parse(release.published_at) || undefined : undefined,
      metadata: {
        repo: release.repo,
        tag: release.tag_name,
        author: release.author?.login,
        prerelease: release.prerelease,
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
    };
  }
}

export function createGitHubReleasesPlugin(deps: GitHubReleasesPluginDeps): GitHubReleasesPlugin {
  return new GitHubReleasesPlugin(deps);
}

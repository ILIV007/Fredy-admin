/**
 * src/plugins/sources/github/index.ts
 * GitHub content source plugin.
 *
 * Fetches trending GitHub repositories (created recently, sorted by stars).
 * Category A (developer content, open source).
 *
 * GitHub API: https://docs.github.com/en/rest/search
 * GET https://api.github.com/search/repositories?q=created:>YYYY-MM-DD&sort=stars&order=desc
 *
 * Requires GITHUB_TOKEN for higher rate limit (60/hr unauth, 5000/hr authed).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubManifest } from "./manifest";
export { githubManifest } from "./manifest";

const GH_API = "https://api.github.com";
const CACHE_KEY = "fredy:source:github:trending";
const CACHE_TTL_SECONDS = 4 * 3600; // 4 hours

// Topic rotation for variety
const TOPICS = [
  "typescript", "rust", "go", "python", "ai", "llm", "react",
  "vue", "svelte", "docker", "kubernetes", "wasm", "zig", "elixir",
];

export interface GitHubPluginDeps {
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
  updated_at?: string;
  owner?: { login?: string; avatar_url?: string };
}

export class GitHubPlugin implements Plugin {
  readonly metadata = githubManifest;

  constructor(private readonly deps: GitHubPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  /** v11.6.2: Extract "owner/repo" from GitHub data for display.
   *  Handles: html_url, full_name, api url, and regular github.com URLs. */
  private extractGithubRepo(raw: unknown): string {
    try {
      const obj = raw as Record<string, unknown>;
      // Priority 1: full_name field (already "owner/repo")
      if (typeof obj["full_name"] === "string" && obj["full_name"].includes("/")) {
        return obj["full_name"] as string;
      }
      // Priority 2: html_url (https://github.com/owner/repo)
      const htmlUrl = obj["html_url"] as string | undefined;
      if (htmlUrl) {
        const match = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(htmlUrl);
        if (match && match[1] && match[2]) {
          return `${match[1]}/${match[2]}`;
        }
      }
      // Priority 3: url field (could be API URL or HTML URL)
      const url = obj["url"] as string | undefined;
      if (url) {
        // API URL: https://api.github.com/repos/owner/repo
        const apiMatch = /api\.github\.com\/repos\/([^/]+)\/([^/?#]+)/i.exec(url);
        if (apiMatch && apiMatch[1] && apiMatch[2]) {
          return `${apiMatch[1]}/${apiMatch[2]}`;
        }
        // Regular URL: https://github.com/owner/repo
        const match = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(url);
        if (match && match[1] && match[2]) {
          return `${match[1]}/${match[2]}`;
        }
      }
      // Priority 4: repo field (events have { repo: { name: "owner/repo" } })
      const repo = obj["repo"] as { name?: string } | undefined;
      if (repo?.name && repo.name.includes("/")) {
        return repo.name;
      }
    } catch { /* non-fatal */ }
    return "GitHub";
  }


  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "github", count: cached.length });
      return cached;
    }

    // Build URL — repos created in last 30 days, sorted by stars
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split("T")[0]!;
    const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)]!;

    const params = new URLSearchParams({
      q: `topic:${topic} created:>${thirtyDaysAgo}`,
      sort: "stars",
      order: "desc",
      per_page: "15",
    });

    const url = `${GH_API}/search/repositories?${params.toString()}`;

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy)",
      "Accept": "application/vnd.github+json",
    };

    // Use GitHub token if available for higher rate limit
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as { items?: GHRepo[]; total_count?: number };
    const repos = data.items ?? [];

    // v9.2.0: Filter: must have stars >= 100 and description
    const filtered = repos.filter((r) =>
      (r.stargazers_count ?? 0) >= 100 && r.description && r.html_url,
    );

    const items = filtered.map((r) => this.normalize(r));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "github",
      topic,
      totalRepos: repos.length,
      filtered: filtered.length,
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const repo = raw as GHRepo;
    const ownerLogin = repo.owner?.login ?? "";
    const ownerAvatar = repo.owner?.avatar_url ?? undefined;
    return {
      id: `gh-${repo.id ?? repo.full_name ?? ""}`,
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
        owner: ownerLogin,
      },
            displayIcon: this.metadata.displayIcon ?? "🐙",
      displaySource: this.extractGithubRepo(raw),
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

export function createGitHubPlugin(deps: GitHubPluginDeps): GitHubPlugin {
  return new GitHubPlugin(deps);
}

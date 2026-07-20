/**
 * src/plugins/sources/github-events/index.ts
 * v11.14.0: Complete refactor — GitHub Discovery Provider.
 *
 * Instead of publishing raw events, this plugin:
 * 1. Fetches events from GitHub Events API
 * 2. Extracts repository names from useful events
 * 3. Fetches repository details via GET /repos/{owner}/{repo}
 * 4. Applies quality filters (stars, forks, activity, etc.)
 * 5. Returns validated repositories as SourceItems
 *
 * The published post describes the REPOSITORY, not the event.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubEventsManifest } from "./manifest";
export { githubEventsManifest } from "./manifest";

const GH_API = "https://api.github.com";
const CACHE_KEY = "fredy:source:github-events:discovered";
const CACHE_TTL_SECONDS = 2 * 3600; // 2 hours (Tier S)

/** Only these event types are useful for discovery. */
const USEFUL_EVENT_TYPES = new Set([
  "ReleaseEvent",
  "PushEvent",
  "CreateEvent",
  "PublicEvent",
]);

/** Orgs to poll for events. */
const WATCHED_ORGS = [
  "microsoft", "vercel", "facebook", "rust-lang", "golang",
  "nodejs", "python", "tailwindlabs", "prisma", "cloudflare",
  "denoland", "oven-sh", "astral-sh", "withastro", "openai",
  "hashicorp", "grafana", "elastic", "posthog", "supabase",
  "nuxt", "sveltejs", "vuetifyjs", "quasarframework",
];

/** Minimum quality thresholds. */
const MIN_STARS = 500;
const MIN_FORKS = 50;
const MIN_DESCRIPTION_LENGTH = 10;
const MAX_INACTIVE_DAYS = 180;
const MIN_REPO_AGE_DAYS = 30;

interface GHEvent {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string };
  payload?: {
    action?: string;
    ref?: string;
    ref_type?: string;
    release?: { tag_name?: string };
  };
}

interface GHRepo {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  default_branch: string;
  homepage: string | null;
  archived: boolean;
  disabled: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  topics?: string[];
}

export interface GitHubEventsPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class GitHubEventsPlugin implements Plugin {
  readonly metadata = githubEventsManifest;

  constructor(private readonly deps: GitHubEventsPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  /** v11.6.2: Extract "owner/repo" from GitHub data for display.
   *  v12.0.0: Removed dead code — github-events was refactored to a Discovery
   *  Provider in v11.14.0 and no longer calls this method. The repo name is
   *  now extracted inline during fetch() via the repo detail API response. */

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-events" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "github-events", count: cached.length });
      return cached;
    }

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    // Step 1: Fetch events from random orgs.
    const shuffled = [...WATCHED_ORGS].sort(() => Math.random() - 0.5).slice(0, 5);
    const discoveredRepos = new Set<string>();

    this.deps.logger.info("source.fetch_start", {
      plugin: "github-events",
      orgsChecked: shuffled.length,
      message: "Fetching events from orgs",
    });

    for (const org of shuffled) {
      try {
        const url = `${GH_API}/users/${org}/events/public?per_page=30`;
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const events = await res.json() as GHEvent[];

        for (const event of events) {
          if (!USEFUL_EVENT_TYPES.has(event.type)) continue;
          const repoName = event.repo?.name;
          if (!repoName || !repoName.includes("/")) continue;
          discoveredRepos.add(repoName);
        }
      } catch { /* try next org */ }
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "github-events",
      eventsFetched: true,
      reposDiscovered: discoveredRepos.size,
      message: `Discovered ${discoveredRepos.size} unique repos from events`,
    });

    if (discoveredRepos.size === 0) {
      // Fallback: search for popular repos.
      return this.fetchPopularRepos(headers);
    }

    // Step 2: Fetch repo details and filter.
    const repoList = Array.from(discoveredRepos).slice(0, 10);
    const items: SourceItem[] = [];
    let accepted = 0;
    let rejected = 0;

    for (const repoName of repoList) {
      try {
        const repoRes = await fetch(`${GH_API}/repos/${repoName}`, { headers });
        if (!repoRes.ok) { rejected++; continue; }
        const repo = await repoRes.json() as GHRepo;

        // Step 3: Quality filters.
        if (!this.passesQualityFilters(repo)) {
          rejected++;
          continue;
        }

        items.push(this.normalizeRepo(repo));
        accepted++;
      } catch { rejected++; }
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "github-events",
      reposDiscovered: discoveredRepos.size,
      reposChecked: repoList.length,
      accepted,
      rejected,
      message: `Discovery: ${accepted} accepted, ${rejected} rejected`,
    });

    if (items.length === 0) {
      // Fallback if all discovered repos failed quality filters.
      return this.fetchPopularRepos(headers);
    }

    // Cache and return.
    await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    return items;
  }

  /** Quality filter — only high-quality repos pass. */
  private passesQualityFilters(repo: GHRepo): boolean {
    if (repo.stargazers_count < MIN_STARS) return false;
    if (repo.forks_count < MIN_FORKS) return false;
    if (repo.archived) return false;
    if (repo.disabled) return false;
    if (!repo.description || repo.description.length < MIN_DESCRIPTION_LENGTH) return false;
    if (!repo.language) return false;

    // Repository age — must be older than 30 days.
    const createdAt = Date.parse(repo.created_at);
    if (Number.isFinite(createdAt)) {
      const ageDays = (Date.now() - createdAt) / (24 * 3600 * 1000);
      if (ageDays < MIN_REPO_AGE_DAYS) return false;
    }

    // Recent activity — must have been pushed within 180 days.
    const pushedAt = Date.parse(repo.pushed_at);
    if (Number.isFinite(pushedAt)) {
      const inactiveDays = (Date.now() - pushedAt) / (24 * 3600 * 1000);
      if (inactiveDays > MAX_INACTIVE_DAYS) return false;
    }

    return true;
  }

  /** Normalize a repo into a SourceItem that describes the REPOSITORY, not the event. */
  private normalizeRepo(repo: GHRepo): SourceItem {
    const topics = repo.topics ?? [];
    const stars = repo.stargazers_count;
    const forks = repo.forks_count;

    // Build a description-rich body for AI.
    const bodyParts = [
      repo.description ?? "",
      `Language: ${repo.language ?? "Unknown"}`,
      `Stars: ${stars.toLocaleString()}`,
      `Forks: ${forks.toLocaleString()}`,
      topics.length > 0 ? `Topics: ${topics.join(", ")}` : "",
      repo.homepage ? `Homepage: ${repo.homepage}` : "",
    ].filter(Boolean);

    return {
      id: `repo-${repo.full_name}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: repo.full_name,
      body: bodyParts.join("\n"),
      url: repo.html_url,
      language: "en",
      publishedAt: Date.parse(repo.pushed_at) || undefined,
      metadata: {
        repo: repo.full_name,
        stars,
        forks,
        language: repo.language,
        topics,
        homepage: repo.homepage,
        openIssues: repo.open_issues_count,
        defaultBranch: repo.default_branch,
      },
      displayIcon: this.metadata.displayIcon ?? "🐙",
      displaySource: repo.full_name,
      fetchedAt: Date.now(),
    };
  }

  /** Fallback: search for popular TypeScript repos. */
  private async fetchPopularRepos(headers: Record<string, string>): Promise<readonly SourceItem[]> {
    try {
      const url = `${GH_API}/search/repositories?q=stars:>500+language:typescript&sort=stars&order=desc&per_page=10`;
      const res = await fetch(url, { headers });
      if (!res.ok) return [];

      const data = await res.json() as { items?: readonly GHRepo[] };
      const repos = data.items ?? [];

      const items = repos
        .filter((repo) => this.passesQualityFilters(repo))
        .slice(0, 10)
        .map((repo) => this.normalizeRepo(repo));

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
      }

      this.deps.logger.info("source.fetch_success", {
        plugin: "github-events",
        fallback: "search",
        returned: items.length,
      });
      return items;
    } catch {
      return [];
    }
  }

  normalize(raw: unknown): SourceItem {
    const repo = raw as GHRepo;
    return this.normalizeRepo(repo);
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
      itemsAccepted: 0, itemsRejected: 0, averageLatencyMs: null,
      consecutiveEmptyFetches: 0, currentBackoffMultiplier: 1, lastRefreshAt: null,
    };
  }
}

export function createGitHubEventsPlugin(deps: GitHubEventsPluginDeps): GitHubEventsPlugin {
  return new GitHubEventsPlugin(deps);
}

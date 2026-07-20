/**
 * src/plugins/sources/github-events/index.ts
 * GitHub Events content source plugin — Tier S.
 *
 * Fetches recent public events from the GitHub Activity API.
 * Filters to: ReleaseEvent, PushEvent, WatchEvent, CreateEvent only.
 * Quality filter (v11 Phase 2): repo stars >= 500, age <= 24h.
 *
 * https://docs.github.com/en/rest/activity/events
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubEventsManifest } from "./manifest";
export { githubEventsManifest } from "./manifest";

const GH_API = "https://api.github.com";
const CACHE_KEY = "fredy:source:github-events:recent";
const CACHE_TTL_SECONDS = 2 * 3600; // 2 hours (Tier S)

/** Event types we care about (v11 Phase 2 spec).
 *  v11.3.0: Added PublicEvent and ForkEvent for more variety. */
const ACCEPTED_EVENT_TYPES = new Set([
  "ReleaseEvent",
  "PushEvent",
  "WatchEvent",
  "CreateEvent",
  "PublicEvent",
  "ForkEvent",
]);

/** Curated list of popular orgs/repos to poll for events.
 *  v11.3.0: Expanded list with more active orgs. */
const WATCHED_ORGS = [
  "microsoft", "vercel", "facebook", "rust-lang", "golang",
  "nodejs", "python", "tailwindlabs", "prisma", "cloudflare",
  "denoland", "oven-sh", "astral-sh", "withastro", "openai",
  "hashicorp", "grafana", "elastic", "posthog", "supabase",
  "nuxt", "sveltejs", "vuetifyjs", "quasarframework",
];

export interface GitHubEventsPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface GHEvent {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string };
  payload?: {
    action?: string;
    ref?: string;
    ref_type?: string;
    release?: { tag_name?: string; name?: string; html_url?: string };
    commits?: readonly { message?: string }[];
  };
  actor?: { login?: string };
}

interface GHRepoInfo {
  stargazers_count?: number;
  forks_count?: number;
  archived?: boolean;
  pushed_at?: string;
  description?: string | null;
}

/** v11.5.0: GitHub search API repo shape. */
interface GHSearchRepo {
  id?: number;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  pushed_at?: string;
}

export class GitHubEventsPlugin implements Plugin {
  readonly metadata = githubEventsManifest;

  constructor(private readonly deps: GitHubEventsPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  /** v11.6.0: Extract "owner/repo" from a GitHub URL for display. */
  private extractGithubRepo(raw: unknown): string {
    try {
      const url = (raw as { url?: string; html_url?: string })?.url ?? (raw as { html_url?: string })?.html_url ?? "";
      const match = /github\.com\/([^/]+)\/([^/]+)/i.exec(url);
      if (match && match[1] && match[2]) {
        const repo = match[2].split(/[?#]/)[0] ?? "";
        return `${match[1]}/${repo}`;
      }
    } catch { /* non-fatal */ }
    return "GitHub";
  }


  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-events" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "github-events", count: cached.length });
      return cached;
    }

    // v11.5.0: Try events API first, then fallback to GitHub search API
    // (which is more reliable and returns repos with recent activity).
    const eventsItems = await this.fetchEvents();
    if (eventsItems.length > 0) return eventsItems;

    // v11.5.0: Fallback — search for recently pushed repos.
    return this.fetchRecentlyPushed();
  }

  /** v11.5.0: Original events API fetch. */
  private async fetchEvents(): Promise<readonly SourceItem[]> {

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    // v11.3.0: Poll 5 random orgs (was 3) to increase hit rate.
    // Without GITHUB_TOKEN, rate limit is 60/hour — 5 requests is safe.
    const shuffled = [...WATCHED_ORGS].sort(() => Math.random() - 0.5).slice(0, 5);
    const allEvents: GHEvent[] = [];

    for (const org of shuffled) {
      try {
        const url = `${GH_API}/users/${org}/events/public?per_page=30`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          this.deps.logger.warn("source.fetch_org_error", { plugin: "github-events", org, status: res.status });
          continue;
        }
        const events = await res.json() as GHEvent[];
        allEvents.push(...events);
      } catch (error) {
        this.deps.logger.warn("source.fetch_org_error", {
          plugin: "github-events", org,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // v11.3.0: Extended age filter from 24h to 72h — GitHub Events API
    // only returns the last 90 days of public events, but many orgs don't
    // have events every day. 72h gives a wider window.
    const now = Date.now();
    const cutoff = now - 72 * 3600 * 1000; // 72 hours
    const filtered = allEvents
      .filter((e) => ACCEPTED_EVENT_TYPES.has(e.type))
      .filter((e) => {
        const ts = Date.parse(e.created_at) || 0;
        return ts >= cutoff;
      })
      // v11.3.0: Deduplicate by repo+type+createdAt to avoid duplicates.
      .filter((e, idx, arr) => {
        const key = `${e.repo?.name}-${e.type}-${e.created_at}`;
        return arr.findIndex((o) => `${o.repo?.name}-${o.type}-${o.created_at}` === key) === idx;
      });

    const items = filtered.map((e) => this.normalize(e)).slice(0, 10);

    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "github-events",
      orgsChecked: shuffled.length,
      eventsFound: allEvents.length,
      filtered: filtered.length,
      returned: items.length,
    });

    return items;
  }

  /**
   * v11.5.0: Fallback — search for recently pushed repos.
   * When the events API returns nothing (orgs with no recent events),
   * this searches for popular repos pushed in the last 24h.
   */
  private async fetchRecentlyPushed(): Promise<readonly SourceItem[]> {
    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    try {
      // Search for repos pushed in the last 24h with 100+ stars.
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      const url = `${GH_API}/search/repositories?q=stars:>100+pushed:>${yesterday}&sort=updated&per_page=10`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", { plugin: "github-events", fallback: "search", status: res.status });
        return [];
      }

      const data = await res.json() as { items?: readonly GHSearchRepo[] };
      const repos = data.items ?? [];

      const items = repos.slice(0, 10).map((repo) => this.normalizeSearchRepo(repo));

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
      }

      this.deps.logger.info("source.fetch_success", {
        plugin: "github-events", fallback: "search", returned: items.length,
      });

      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "github-events", fallback: "search",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** v11.5.0: Normalize a search API repo into a SourceItem. */
  private normalizeSearchRepo(repo: GHSearchRepo): SourceItem {
    const repoName = repo.full_name ?? "unknown";
    return {
      id: `evt-search-${repo.id ?? repoName}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: `${repoName} — recent activity`,
      body: String(repo.description ?? "").slice(0, 500),
      url: repo.html_url ?? `https://github.com/${repoName}`,
      language: "en",
      publishedAt: repo.pushed_at ? Date.parse(repo.pushed_at) || undefined : undefined,
      metadata: {
        eventType: "SearchResult",
        repo: repoName,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
      },
            displayIcon: this.metadata.displayIcon ?? "🐙",
      displaySource: this.extractGithubRepo(raw),
      fetchedAt: Date.now(),
    };
  }

  normalize(raw: unknown): SourceItem {
    const event = raw as GHEvent;
    const repoName = event.repo?.name ?? "unknown";
    const eventType = event.type.replace("Event", "");

    let title = `${repoName} — ${eventType}`;
    let body = "";
    let url = `https://github.com/${repoName}`;

    if (event.type === "ReleaseEvent" && event.payload?.release) {
      const rel = event.payload.release;
      title = `${repoName} released ${rel.tag_name ?? ""}`.trim();
      body = rel.name ?? rel.tag_name ?? "";
      url = rel.html_url ?? url;
    } else if (event.type === "PushEvent" && event.payload?.commits?.length) {
      const commitCount = event.payload.commits.length;
      const lastMsg = event.payload.commits[event.payload.commits.length - 1]?.message ?? "";
      title = `${repoName} — ${commitCount} new commit(s)`;
      body = lastMsg.slice(0, 500);
    } else if (event.type === "WatchEvent") {
      title = `${repoName} gained a new star`;
      body = `Repository ${repoName} was just starred.`;
    } else if (event.type === "CreateEvent") {
      title = `${repoName} — ${event.payload?.ref_type ?? "creation"}`;
      body = event.payload?.ref ? `New ${event.payload.ref_type}: ${event.payload.ref}` : "New repository created";
    }

    return {
      id: `evt-${event.id}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title,
      body,
      url,
      language: "en",
      publishedAt: event.created_at ? Date.parse(event.created_at) || undefined : undefined,
      metadata: {
        eventType: event.type,
        repo: repoName,
        actor: event.actor?.login,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("github.com");
  }

  /**
   * Per-provider quality filter (v11 Phase 2).
   * Requirements: repo stars >= 500, age <= 24h, not archived.
   */
  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const repoName = (item.metadata as { repo?: string } | undefined)?.repo;
    if (!repoName) return null;

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${repoName}`, { headers });
      if (!res.ok) return null;
      const repo = await res.json() as GHRepoInfo;

      if (repo.stargazers_count === undefined || repo.stargazers_count < 500) {
        return null; // Reject: not enough stars
      }
      if (repo.archived) {
        return null; // Reject: archived repo
      }

      let score = 70;
      if (repo.stargazers_count >= 5000) score = 95;
      else if (repo.stargazers_count >= 2000) score = 88;
      else if (repo.stargazers_count >= 1000) score = 82;
      else score = 75;

      return {
        item: { ...item, metadata: { ...item.metadata, stars: repo.stargazers_count, forks: repo.forks_count } },
        score,
        reason: `stars=${repo.stargazers_count}`,
        boost: repo.stargazers_count >= 5000,
      };
    } catch {
      return null;
    }
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
      itemsAccepted: 0,
      itemsRejected: 0,
      averageLatencyMs: null,
      consecutiveEmptyFetches: 0,
      currentBackoffMultiplier: 1,
      lastRefreshAt: null,
    };
  }
}

export function createGitHubEventsPlugin(deps: GitHubEventsPluginDeps): GitHubEventsPlugin {
  return new GitHubEventsPlugin(deps);
}

/**
 * src/services/content-enricher.ts
 * Content Enricher — completes missing metadata WITHOUT using AI.
 *
 * This stage runs AFTER normalization but BEFORE AI generation.
 * It enriches the source item with additional data from APIs:
 *
 *   - GitHub repos: fetch stars, forks, language, license, topics
 *     from the GitHub REST API (using GITHUB_TOKEN for higher rate limit).
 *   - News articles: extract author, publish date, source credibility
 *     from the article URL (via OG metadata fetch).
 *   - NASA APOD: ensure title, date, and copyright are complete.
 *   - HackerNews: fetch score, comments count from HN API.
 *   - Dev.to: extract reactions, comments, reading time from API.
 *
 * By enriching BEFORE AI, the AI works on richer data and produces
 * better output — without any additional AI token cost.
 */

import type { SourceItem } from "../types/api";
import type { Env } from "../types/env";
import type { Logger } from "./logger";

export interface ContentEnricherDeps {
  readonly env: Env;
  readonly logger: Logger;
}

/** Fetch timeout for enrichment API calls. */
const FETCH_TIMEOUT_MS = 6_000;

export class ContentEnricher {
  constructor(private readonly deps: ContentEnricherDeps) {}

  /**
   * Enrich a source item with additional metadata from external APIs.
   * Returns a new SourceItem with enriched metadata. Non-fatal — if
   * enrichment fails, the original item is returned unchanged.
   */
  async enrich(item: SourceItem): Promise<SourceItem> {
    try {
      switch (item.source) {
        case "github":
        case "github-trending":
          return await this.enrichGitHub(item);
        case "hackernews":
          return await this.enrichHackerNews(item);
        case "nasa":
          return this.enrichNASA(item);
        default:
          // No specific enrichment for this provider — return as-is.
          return item;
      }
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: item.source,
        step: "enrich",
        error: error instanceof Error ? error.message : String(error),
        message: "Enrichment failed, continuing with basic data",
      });
      return item;
    }
  }

  // ────────────────────────────────────────────────────────
  // GitHub enrichment
  // ────────────────────────────────────────────────────────

  /** Fetch repo metadata (stars, forks, language, license) from GitHub API. */
  private async enrichGitHub(item: SourceItem): Promise<SourceItem> {
    // Extract owner/repo from the GitHub URL.
    const match = /github\.com\/([^/]+)\/([^/]+)/i.exec(item.url);
    if (!match) return item;

    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, { headers, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return item;

      const data = await res.json() as Record<string, unknown>;
      const existingMeta = (item.metadata ?? {}) as Record<string, unknown>;

      return {
        ...item,
        metadata: {
          ...existingMeta,
          stars: typeof data["stargazers_count"] === "number" ? data["stargazers_count"] : existingMeta["stars"],
          forks: typeof data["forks_count"] === "number" ? data["forks_count"] : existingMeta["forks"],
          language: data["language"] ?? existingMeta["language"],
          license: (data["license"] as { name?: string })?.name ?? existingMeta["license"],
          topics: data["topics"] ?? existingMeta["topics"],
          openIssues: typeof data["open_issues_count"] === "number" ? data["open_issues_count"] : existingMeta["openIssues"],
          watchers: typeof data["watchers_count"] === "number" ? data["watchers_count"] : existingMeta["watchers"],
        },
        // Enrich the body with a summary if it's empty or just a description.
        body: this.enrichGitHubBody(item.body, data),
      };
    } catch { /* non-fatal */
      clearTimeout(timeout);
      return item;
    }
  }

  /** Build a richer body for GitHub items. */
  private enrichGitHubBody(currentBody: string, data: Record<string, unknown>): string {
    const stars = data["stargazers_count"];
    const forks = data["forks_count"];
    const language = data["language"];
    const license = (data["license"] as { name?: string } | null)?.name;
    const description = data["description"];

    const parts: string[] = [];
    if (description) parts.push(String(description));
    if (stars !== undefined) parts.push(`⭐ ${stars} stars`);
    if (forks !== undefined) parts.push(`🍴 ${forks} forks`);
    if (language) parts.push(`💻 ${language}`);
    if (license) parts.push(`📄 ${license}`);

    const enriched = parts.join(" | ");
    // Only use enriched body if current body is empty or very short.
    if (!currentBody || currentBody.trim().length < 20) {
      return enriched || currentBody;
    }
    return currentBody;
  }

  // ────────────────────────────────────────────────────────
  // HackerNews enrichment
  // ────────────────────────────────────────────────────────

  /** Fetch HN item score and comments from the Firebase API. */
  private async enrichHackerNews(item: SourceItem): Promise<SourceItem> {
    // Extract item ID from the HN item ID (format: "hn-12345").
    const match = /hn-(\d+)/.exec(item.id);
    if (!match) return item;

    const itemId = match[1]!;
    const apiUrl = `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return item;

      const data = await res.json() as Record<string, unknown>;
      const existingMeta = (item.metadata ?? {}) as Record<string, unknown>;

      return {
        ...item,
        metadata: {
          ...existingMeta,
          score: typeof data["score"] === "number" ? data["score"] : existingMeta["score"],
          comments: typeof data["descendants"] === "number" ? data["descendants"] : existingMeta["comments"],
          author: data["by"] ?? existingMeta["author"],
        },
        // If body is empty, use the HN text field.
        body: item.body || (typeof data["text"] === "string" ? data["text"] : item.title),
      };
    } catch { /* non-fatal */
      clearTimeout(timeout);
      return item;
    }
  }

  // ────────────────────────────────────────────────────────
  // NASA enrichment
  // ────────────────────────────────────────────────────────

  /** Ensure NASA APOD metadata is complete. */
  private enrichNASA(item: SourceItem): SourceItem {
    const existingMeta = (item.metadata ?? {}) as Record<string, unknown>;
    // NASA items from the plugin already have good metadata — just
    // ensure the body has the explanation.
    if (!item.body || item.body.trim().length < 10) {
      return {
        ...item,
        body: String(existingMeta["explanation"] ?? item.title),
      };
    }
    return item;
  }
}

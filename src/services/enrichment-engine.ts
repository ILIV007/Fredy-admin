/**
 * src/services/enrichment-engine.ts
 * Enriches StandardPost with provider-specific metadata BEFORE AI processing.
 *
 * GitHub: stars, forks, language, license, last update, topics
 * News: author, publish date, source credibility
 * Tech Tools: official site, documentation, pricing
 * NASA: image metadata, date, explanation context
 *
 * See Prompt 11 spec.
 */

import type { StandardPost, ProviderEnrichment } from "../types/content";
import type { SourceItem } from "../types/api";
import type { Logger } from "./logger";

export interface EnrichmentEngineDeps {
  readonly logger: Logger;
}

/** Known credible news sources. */
const CREDIBLE_SOURCES: Readonly<Record<string, "high" | "medium" | "low">> = {
  "techcrunch.com": "high",
  "theverge.com": "high",
  "arstechnica.com": "high",
  "wired.com": "high",
  "github.com": "high",
  "stackoverflow.com": "high",
  "dev.to": "medium",
  "hackernews": "medium",
  "reddit.com": "low",
};

export class EnrichmentEngine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_deps: EnrichmentEngineDeps) {
    void _deps;
  }

  /** Enrich a StandardPost with provider-specific metadata. */
  async enrich(post: StandardPost): Promise<StandardPost> {
    const enrichment = await this.buildEnrichment(post);

    return {
      ...post,
      provider: { ...post.provider, ...enrichment },
    };
  }

  /** Build enrichment data based on the provider. */
  private async buildEnrichment(post: StandardPost): Promise<Partial<ProviderEnrichment>> {
    const source = post.source;
    const raw = post.raw;

    switch (source) {
      case "github":
      case "github-trending":
      case "github-releases":
        return this.enrichGitHub(raw);

      case "news":
        return this.enrichNews(raw, post.url);

      case "hackernews":
        return this.enrichHackerNews(raw);

      case "devto":
        return this.enrichDevTo(raw);

      case "stackexchange":
        return this.enrichStackExchange(raw);

      case "reddit":
        return this.enrichReddit(raw);

      case "nasa":
        return this.enrichNasa(raw);

      case "xkcd":
        return this.enrichXkcd(raw);

      case "wikimedia":
        return this.enrichWikimedia(raw);

      case "joke":
        return this.enrichJoke(raw);

      default:
        return {};
    }
  }

  // ────────────────────────────────────────────────────────────
  // GitHub enrichment
  // ────────────────────────────────────────────────────────────

  private enrichGitHub(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      stars: typeof meta["stars"] === "number" ? meta["stars"] : undefined,
      forks: typeof meta["forks"] === "number" ? meta["forks"] : undefined,
      language: typeof meta["language"] === "string" ? meta["language"] : undefined,
      license: typeof meta["license"] === "string" ? meta["license"] : undefined,
      lastUpdate: typeof meta["updatedAt"] === "string"
        ? Date.parse(String(meta["updatedAt"]))
        : undefined,
      topics: Array.isArray(meta["topics"]) ? (meta["topics"] as string[]) : undefined,
      officialSite: raw.url,
      documentation: `${raw.url}#readme`,
    };
  }

  // ────────────────────────────────────────────────────────────
  // News enrichment
  // ────────────────────────────────────────────────────────────

  private enrichNews(raw: SourceItem, url: string): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      author: typeof meta["author"] === "string" ? meta["author"] : undefined,
      publishDate: raw.publishedAt ?? undefined,
      sourceCredibility: this.assessCredibility(url),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Hacker News enrichment
  // ────────────────────────────────────────────────────────────

  private enrichHackerNews(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      author: typeof meta["by"] === "string" ? meta["by"] : undefined,
      publishDate: raw.publishedAt ?? undefined,
      sourceCredibility: "medium",
      extra: { score: meta["score"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Dev.to enrichment
  // ────────────────────────────────────────────────────────────

  private enrichDevTo(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      author: typeof meta["author"] === "string" ? meta["author"] : undefined,
      publishDate: raw.publishedAt ?? undefined,
      sourceCredibility: "medium",
      tags: Array.isArray(meta["tags"]) ? (meta["tags"] as string[]) : undefined,
      extra: { reactions: meta["reactions"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Stack Exchange enrichment
  // ────────────────────────────────────────────────────────────

  private enrichStackExchange(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      publishDate: raw.publishedAt ?? undefined,
      sourceCredibility: "high",
      tags: Array.isArray(meta["tags"]) ? (meta["tags"] as string[]) : undefined,
      extra: { score: meta["score"], isAnswered: meta["isAnswered"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Reddit enrichment
  // ────────────────────────────────────────────────────────────

  private enrichReddit(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      author: typeof meta["author"] === "string" ? meta["author"] : undefined,
      publishDate: raw.publishedAt ?? undefined,
      sourceCredibility: "low",
      extra: { score: meta["score"], subreddit: meta["subreddit"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // NASA enrichment
  // ────────────────────────────────────────────────────────────

  private enrichNasa(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    const mediaType = String(meta["mediaType"] ?? "image");
    return {
      imageMetadata: {
        type: mediaType === "video" ? "video" : "image",
        date: String(raw.id ?? ""),
        explanation: raw.body,
      },
      publishDate: raw.publishedAt ?? undefined,
    };
  }

  // ────────────────────────────────────────────────────────────
  // XKCD enrichment
  // ────────────────────────────────────────────────────────────

  private enrichXkcd(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      publishDate: raw.publishedAt ?? undefined,
      extra: { num: meta["num"], alt: meta["alt"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Wikimedia enrichment
  // ────────────────────────────────────────────────────────────

  private enrichWikimedia(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      publishDate: undefined,
      extra: { year: meta["year"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Joke enrichment
  // ────────────────────────────────────────────────────────────

  private enrichJoke(raw: SourceItem): Partial<ProviderEnrichment> {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    return {
      extra: { type: meta["type"], setup: meta["setup"], punchline: meta["punchline"] },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  /** Assess the credibility of a news source based on its domain. */
  private assessCredibility(url: string): "high" | "medium" | "low" | "unknown" {
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      for (const [known, credibility] of Object.entries(CREDIBLE_SOURCES)) {
        if (domain.includes(known)) return credibility;
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }
}

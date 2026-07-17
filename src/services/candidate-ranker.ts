/**
 * src/services/candidate-ranker.ts
 * Scores and ranks content candidates locally (no AI).
 *
 * Ranking factors:
 *   - Freshness (newer = better)
 *   - Source credibility (known sources score higher)
 *   - Content length (too short or too long = lower)
 *   - Image availability (has image = bonus)
 *   - Technical relevance (matches tech keywords = bonus)
 *   - Category priority (A > B > C)
 *   - Trending score (stars/score/reactions from metadata)
 *
 * Only the top-ranked candidates are sent to AI, minimizing token usage.
 */

import type { SourceItem } from "../types/api";
import type { Category } from "../types/category";

export interface CandidateRankerDeps {
  // No deps — pure scoring service.
}

export interface CandidateScore {
  readonly item: SourceItem;
  readonly score: number;
  readonly factors: ScoreFactors;
}

export interface ScoreFactors {
  readonly freshness: number;
  readonly credibility: number;
  readonly length: number;
  readonly image: number;
  readonly relevance: number;
  readonly categoryPriority: number;
  readonly trending: number;
}

/** Known credible sources and their credibility scores (0–100). */
const CREDIBILITY_SCORES: Readonly<Record<string, number>> = {
  "github.com": 95,
  "github-releases": 95,
  "github-trending": 90,
  "dev.to": 75,
  "stackoverflow.com": 85,
  "hackernews": 70,
  "newsapi.org": 65,
  "nasa.gov": 90,
  "xkcd.com": 60,
  "wikimedia": 70,
};

/** Tech relevance keywords (bonus for matching content). */
const TECH_KEYWORDS = [
  "typescript", "javascript", "python", "rust", "go", "java", "c++",
  "react", "vue", "svelte", "next.js", "node", "deno", "bun",
  "docker", "kubernetes", "cloud", "aws", "cloudflare",
  "ai", "ml", "llm", "gpt", "gemini", "openai",
  "security", "crypto", "blockchain",
  "linux", "macos", "windows", "android", "ios",
  "api", "rest", "graphql", "database", "sql",
  "open source", "framework", "library",
];

export class CandidateRanker {
  constructor(_deps: CandidateRankerDeps = {}) {
    void _deps;
  }

  /**
   * Score a single candidate (0–100).
   * Higher = better candidate for AI processing.
   */
  score(item: SourceItem, category: Category): CandidateScore {
    const factors: ScoreFactors = {
      freshness: this.scoreFreshness(item),
      credibility: this.scoreCredibility(item),
      length: this.scoreLength(item),
      image: this.scoreImage(item),
      relevance: this.scoreRelevance(item),
      categoryPriority: this.scoreCategoryPriority(category),
      trending: this.scoreTrending(item),
    };

    // Weighted sum.
    const score = Math.round(
      factors.freshness * 0.15 +
      factors.credibility * 0.20 +
      factors.length * 0.10 +
      factors.image * 0.10 +
      factors.relevance * 0.15 +
      factors.categoryPriority * 0.10 +
      factors.trending * 0.20,
    );

    return { item, score: Math.min(100, Math.max(0, score)), factors };
  }

  /**
   * Rank a list of candidates by score (descending).
   * Returns the sorted list with scores attached.
   */
  rank(items: readonly SourceItem[], category: Category): CandidateScore[] {
    return items
      .map((item) => this.score(item, category))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get the top N candidates.
   * Only these should be sent to AI.
   */
  topN(items: readonly SourceItem[], category: Category, n: number): SourceItem[] {
    return this.rank(items, category)
      .slice(0, n)
      .map((c) => c.item);
  }

  // ────────────────────────────────────────────────────────
  // Scoring factors
  // ────────────────────────────────────────────────────────

  /** Freshness: newer items score higher (0–100). */
  private scoreFreshness(item: SourceItem): number {
    const now = Date.now();
    const timestamp = item.fetchedAt ?? item.publishedAt ?? now;
    const ageHours = (now - timestamp) / (60 * 60 * 1000);
    if (ageHours < 1) return 100;
    if (ageHours < 6) return 90;
    if (ageHours < 12) return 80;
    if (ageHours < 24) return 70;
    if (ageHours < 48) return 50;
    if (ageHours < 72) return 30;
    return 10;
  }

  /** Credibility: known sources score higher (0–100). */
  private scoreCredibility(item: SourceItem): number {
    return CREDIBILITY_SCORES[item.source] ?? 50;
  }

  /** Content length: optimal range scores higher (0–100). */
  private scoreLength(item: SourceItem): number {
    const len = (item.body ?? "").length;
    if (len < 10) return 10;
    if (len < 50) return 40;
    if (len < 200) return 70;
    if (len < 1000) return 100;
    if (len < 2000) return 90;
    return 60;
  }

  /** Image availability: has image = 100, no image = 30 (0–100). */
  private scoreImage(item: SourceItem): number {
    if (item.imageUrl && item.imageUrl.length > 10) return 100;
    if (item.media && item.media.url) return 100;
    return 30;
  }

  /** Technical relevance: matches tech keywords (0–100). */
  private scoreRelevance(item: SourceItem): number {
    const text = `${item.title} ${item.body}`.toLowerCase();
    let matches = 0;
    for (const kw of TECH_KEYWORDS) {
      if (text.includes(kw)) matches++;
    }
    // 3+ matches = 100, 2 = 80, 1 = 60, 0 = 30.
    if (matches >= 3) return 100;
    if (matches === 2) return 80;
    if (matches === 1) return 60;
    return 30;
  }

  /** Category priority: A = 100, B = 70, C = 40 (0–100). */
  private scoreCategoryPriority(category: Category): number {
    switch (category) {
      case "A": return 100;
      case "B": return 70;
      case "C": return 40;
      default: return 50;
    }
  }

  /** Trending: stars/score/reactions from metadata (0–100). */
  private scoreTrending(item: SourceItem): number {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const stars = typeof meta["stars"] === "number" ? meta["stars"] : 0;
    if (stars > 0) {
      const logStars = Math.log10(Math.max(1, stars));
      return Math.min(100, Math.round(logStars * 25));
    }
    const score = typeof meta["score"] === "number" ? meta["score"] : 0;
    if (score > 0) {
      const logScore = Math.log10(Math.max(1, score));
      return Math.min(100, Math.round(logScore * 25));
    }
    const reactions = typeof meta["reactions"] === "number" ? meta["reactions"] : 0;
    if (reactions > 0) {
      const logReactions = Math.log10(Math.max(1, reactions));
      return Math.min(100, Math.round(logReactions * 25));
    }
    return 30; // no trending data — neutral.
  }
}

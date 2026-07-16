/**
 * src/services/popularity-filter.ts
 * Pre-filters source items by popularity metrics BEFORE they enter the AI
 * pipeline. This saves AI tokens (we don't waste calls on 1-star repos)
 * and improves channel quality (only items the community has validated
 * get through).
 *
 * Each source plugin exposes popularity metadata in `item.metadata`
 * (stars, views, score, etc.). This module normalizes those into a
 * single 0–100 popularity score and applies a configurable threshold.
 *
 * Items that lack any popularity metadata (e.g., XKCD, JokeAPI) are
 * exempt — they're allowed through, since popularity metrics don't
 * apply to them.
 */

import type { SourceItem } from "../types/api";

export interface PopularityFilterDeps {
  /** Minimum popularity score (0–100). Items below this are rejected.
   *  Default: 30 (filters out obscure repos but allows mid-tier content). */
  readonly minScore?: number;
}

/** Default minimum popularity score (0–100). */
const DEFAULT_MIN_SCORE = 30;

/** Per-plugin minimum star counts — used when the plugin exposes
 *  `metadata.stars` directly (GitHub, GitHub Trending, GitHub Releases). */
const PLUGIN_MIN_STARS: Readonly<Record<string, number>> = {
  github: 50,           // main GitHub plugin — be picky
  "github-trending": 100, // trending should be genuinely trending
  "github-releases": 0,   // releases are pre-curated (we picked the repos)
  // Other plugins don't have stars — they're exempt.
};

/** Per-plugin minimum score/points/reactions thresholds for HN/SE/Dev.to.
 *  These are HARD floors applied on top of the log-based popularity score. */
const PLUGIN_MIN_SCORE: Readonly<Record<string, number>> = {
  hackernews: 50,        // HN: min 50 points (was already filtered, now enforced)
  stackexchange: 5,      // StackExchange: min 5 score (was 1, now stricter)
  devto: 50,             // Dev.to: min 50 reactions
  // news, nasa, joke, xkcd, wikimedia, reddit — no score metric, exempt.
};

export class PopularityFilter {
  private readonly minScore: number;

  constructor(deps: PopularityFilterDeps = {}) {
    this.minScore = deps.minScore ?? DEFAULT_MIN_SCORE;
  }

  /**
   * Filter a list of source items by popularity.
   * Returns only items that meet the threshold (or are exempt).
   * Also sorts the result by popularity descending, so the AI pipeline
   * tries the most popular items first.
   */
  filter(items: readonly SourceItem[]): SourceItem[] {
    const scored = items
      .map((item) => ({ item, score: this.score(item) }))
      .filter(({ item, score }) => this.isExempt(item) || score >= this.minScore);

    // Sort by score descending (highest popularity first).
    scored.sort((a, b) => b.score - a.score);

    return scored.map(({ item }) => item);
  }

  /**
   * Compute a 0–100 popularity score for an item.
   * Combines stars, views, score, points, reactions, comments into a single
   * normalized metric using a logarithmic scale.
   */
  score(item: SourceItem): number {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;

    // 1. Stars (GitHub plugins).
    const stars = typeof meta.stars === "number" ? meta.stars : 0;
    if (stars > 0) {
      const logStars = Math.log10(Math.max(1, stars));
      return Math.min(100, Math.round(logStars * 25));
    }

    // 2. Score (HackerNews, StackExchange).
    const score = typeof meta.score === "number" ? meta.score : 0;
    if (score > 0) {
      const logScore = Math.log10(Math.max(1, score));
      return Math.min(100, Math.round(logScore * 25));
    }

    // 3. Points (StackExchange).
    const points = typeof meta.points === "number" ? meta.points : 0;
    if (points > 0) {
      const logPoints = Math.log10(Math.max(1, points));
      return Math.min(100, Math.round(logPoints * 25));
    }

    // 4. Reactions (Dev.to).
    const reactions = typeof meta.reactions === "number" ? meta.reactions : 0;
    if (reactions > 0) {
      const logReactions = Math.log10(Math.max(1, reactions));
      return Math.min(100, Math.round(logReactions * 25));
    }

    // 5. Comments (Dev.to, HN).
    const comments = typeof meta.comments === "number" ? meta.comments : 0;
    if (comments > 0) {
      const logComments = Math.log10(Math.max(1, comments));
      return Math.min(100, Math.round(logComments * 20));
    }

    // 6. Views (some plugins).
    const views = typeof meta.views === "number" ? meta.views : 0;
    if (views > 0) {
      const logViews = Math.log10(Math.max(1, views));
      return Math.min(100, Math.round(logViews * 20));
    }

    // 7. No popularity metadata — return 0 (will be exempt from filtering).
    return 0;
  }

  /**
   * Some plugins don't expose popularity metrics because they don't
   * apply (e.g., XKCD comics, jokes, NASA APOD). Items from these
   * plugins are always allowed through.
   */
  private isExempt(item: SourceItem): boolean {
    return EXEMPT_PLUGINS.has(item.source);
  }

  /**
   * Hard minimum-score/reactions gate for plugins that expose these
   * metrics (HN, StackExchange, Dev.to). Applied on top of the log-based
   * popularity score.
   */
  meetsMinScore(item: SourceItem): boolean {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const pluginId = item.source;
    const min = PLUGIN_MIN_SCORE[pluginId] ?? 0;
    if (min === 0) return true; // no hard floor for this plugin

    // Check the appropriate metric based on plugin.
    if (pluginId === "hackernews" || pluginId === "stackexchange") {
      const score = typeof meta.score === "number" ? meta.score : 0;
      return score >= min;
    }
    if (pluginId === "devto") {
      const reactions = typeof meta.reactions === "number" ? meta.reactions : 0;
      return reactions >= min;
    }
    return true;
  }

  /**
   * Hard minimum-star gate for GitHub plugins. Even if the popularity
   * score threshold is met, repos below this absolute floor are rejected.
   * This catches the case where the API query returns mixed-quality
   * results and the log-based score still lets low-star repos through.
   */
  meetsMinStars(item: SourceItem): boolean {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const stars = typeof meta.stars === "number" ? meta.stars : null;
    if (stars === null) return true; // no stars metadata — allow
    const min = PLUGIN_MIN_STARS[item.source] ?? 0;
    return stars >= min;
  }
}

/** Plugins that don't have popularity metrics and bypass the filter. */
const EXEMPT_PLUGINS = new Set<string>([
  "nasa",
  "joke",
  "xkcd",
  "wikimedia",
  "reddit",
  "news",
]);

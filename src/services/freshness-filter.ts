/**
 * src/services/freshness-filter.ts
 * Filters out outdated content based on configurable freshness rules.
 *
 * Rules by category:
 *   - News (B): reject if older than `newsMaxAgeHours` (default 48h)
 *   - GitHub releases: reject if already published (handled by dedup)
 *   - NASA APOD: reject if date is in the future or older than 7 days
 *   - General: reject if `fetchedAt` is older than `generalMaxAgeHours` (default 168h = 7 days)
 *
 * This stage runs BEFORE AI — no tokens wasted on stale content.
 */

import type { SourceItem } from "../types/api";
import type { Category } from "../types/category";

export interface FreshnessFilterDeps {
  /** Max age for news content (hours). Default: 48. */
  readonly newsMaxAgeHours?: number;
  /** Max age for general content (hours). Default: 168 (7 days). */
  readonly generalMaxAgeHours?: number;
  /** Max age for NASA APOD (days). Default: 7. */
  readonly nasaMaxAgeDays?: number;
}

export interface FreshnessResult {
  readonly fresh: boolean;
  readonly reason: string | null;
  readonly ageHours: number;
}

const DEFAULT_NEWS_MAX_AGE_HOURS = 48;
const DEFAULT_GENERAL_MAX_AGE_HOURS = 168;
const DEFAULT_NASA_MAX_AGE_DAYS = 7;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export class FreshnessFilter {
  private readonly newsMaxAgeHours: number;
  private readonly generalMaxAgeHours: number;
  private readonly nasaMaxAgeDays: number;

  constructor(deps: FreshnessFilterDeps = {}) {
    this.newsMaxAgeHours = deps.newsMaxAgeHours ?? DEFAULT_NEWS_MAX_AGE_HOURS;
    this.generalMaxAgeHours = deps.generalMaxAgeHours ?? DEFAULT_GENERAL_MAX_AGE_HOURS;
    this.nasaMaxAgeDays = deps.nasaMaxAgeDays ?? DEFAULT_NASA_MAX_AGE_DAYS;
  }

  /** Check if a source item is fresh enough to process. */
  check(item: SourceItem, category: Category): FreshnessResult {
    const now = Date.now();

    // Use fetchedAt as the primary timestamp, fall back to publishedAt.
    const timestamp = item.fetchedAt ?? item.publishedAt ?? now;
    const ageMs = now - timestamp;
    const ageHours = ageMs / MS_PER_HOUR;

    // Category B (news) — strict freshness.
    if (category === "B") {
      if (ageHours > this.newsMaxAgeHours) {
        return {
          fresh: false,
          reason: `News too old: ${ageHours.toFixed(1)}h > ${this.newsMaxAgeHours}h`,
          ageHours,
        };
      }
    }

    // NASA APOD — check the date in metadata.
    if (item.source === "nasa") {
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const dateStr = typeof meta["date"] === "string" ? meta["date"] : null;
      if (dateStr) {
        const apodDate = Date.parse(dateStr);
        if (!isNaN(apodDate)) {
          const ageDays = (now - apodDate) / MS_PER_DAY;
          if (ageDays > this.nasaMaxAgeDays) {
            return {
              fresh: false,
              reason: `NASA APOD too old: ${ageDays.toFixed(1)} days > ${this.nasaMaxAgeDays} days`,
              ageHours,
            };
          }
          // Future date — reject.
          if (apodDate > now + MS_PER_DAY) {
            return {
              fresh: false,
              reason: `NASA APOD date is in the future: ${dateStr}`,
              ageHours,
            };
          }
        }
      }
    }

    // General check for all content.
    if (ageHours > this.generalMaxAgeHours) {
      return {
        fresh: false,
        reason: `Content too old: ${ageHours.toFixed(1)}h > ${this.generalMaxAgeHours}h`,
        ageHours,
      };
    }

    return { fresh: true, reason: null, ageHours };
  }

  /** Filter a list of items, keeping only fresh ones. */
  filter(items: readonly SourceItem[], category: Category): SourceItem[] {
    return items.filter((item) => this.check(item, category).fresh);
  }
}

/**
 * src/services/breaking-content.ts
 * v11.1.0: Breaking Content — allows ONE extra publish slot per 24h
 * for exceptional content (critical security advisories, major releases,
 * very high HN scores).
 *
 * Rules (per spec):
 *   - Never exceed one breaking slot per day.
 *   - Only providers with canBreak=true can trigger.
 *   - Breaking threshold is configurable per provider.
 *
 * State: `fredy:breaking:lastSlot` (epoch ms of last breaking publish).
 * TTL: 24 hours (auto-expires, allowing the next day's breaking slot).
 */

import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";
import { canProviderBreak } from "../core/providers.config";

export interface BreakingContentDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
}

/** Result of a breaking content check. */
export interface BreakingCheckResult {
  /** Whether this content qualifies as breaking. */
  readonly isBreaking: boolean;
  /** The reason it qualifies (or doesn't). */
  readonly reason: string;
  /** Whether a breaking slot is available today. */
  readonly slotAvailable: boolean;
}

const BREAKING_KEY = "fredy:breaking:lastSlot";
const BREAKING_TTL_SECONDS = 24 * 3600; // 24 hours
const BREAKING_COOLDOWN_MS = 24 * 3600 * 1000; // 24 hours

/** Breaking content thresholds (per provider type). */
const BREAKING_THRESHOLDS: Readonly<Record<string, { readonly metric: string; readonly threshold: number }>> = {
  "github-security": { metric: "cvss", threshold: 9 }, // Critical CVSS >= 9
  "hackernews-algolia": { metric: "points", threshold: 500 }, // HN score >= 500
  "github-releases": { metric: "stars", threshold: 5000 }, // Major repo (5k+ stars)
  "github-events": { metric: "stars", threshold: 5000 },
  "cloudflare-blog": { metric: "topics", threshold: 3 }, // 3+ preferred topics
  "huggingface-blog": { metric: "topics", threshold: 3 },
  "openai-news": { metric: "isModelRelease", threshold: 1 },
};

export class BreakingContentService {
  constructor(private readonly deps: BreakingContentDeps) {}

  /**
   * Check if a content item qualifies as breaking.
   * Also checks if a breaking slot is available today.
   */
  async check(
    providerId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<BreakingCheckResult> {
    // 1. Provider must support breaking content
    if (!canProviderBreak(providerId)) {
      return { isBreaking: false, reason: "provider cannot break", slotAvailable: false };
    }

    // 2. Check against provider-specific threshold
    const threshold = BREAKING_THRESHOLDS[providerId];
    if (!threshold) {
      return { isBreaking: false, reason: "no threshold configured", slotAvailable: false };
    }

    const metricValue = this.extractMetric(metadata, threshold.metric);
    if (metricValue < threshold.threshold) {
      return {
        isBreaking: false,
        reason: `${threshold.metric}=${metricValue} < ${threshold.threshold}`,
        slotAvailable: false,
      };
    }

    // 3. Check if a breaking slot is available (24h cooldown)
    const lastBreaking = await this.deps.kv.get(BREAKING_KEY).catch(() => null);
    const now = Date.now();
    if (lastBreaking) {
      const lastMs = Number(lastBreaking);
      if (Number.isFinite(lastMs) && (now - lastMs) < BREAKING_COOLDOWN_MS) {
        return {
          isBreaking: true,
          reason: `${threshold.metric}=${metricValue} >= ${threshold.threshold}`,
          slotAvailable: false,
        };
      }
    }

    return {
      isBreaking: true,
      reason: `${threshold.metric}=${metricValue} >= ${threshold.threshold}`,
      slotAvailable: true,
    };
  }

  /** Record that a breaking slot was used. */
  async recordBreaking(): Promise<void> {
    await this.deps.kv.set(BREAKING_KEY, String(Date.now()), BREAKING_TTL_SECONDS).catch(() => {});
  }

  /** Extract a numeric metric from metadata. */
  private extractMetric(metadata: Readonly<Record<string, unknown>>, metric: string): number {
    const value = metadata[metric];
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (Array.isArray(value)) return value.length;
    return 0;
  }

  /** Get breaking status for dashboard. */
  async getStatus(): Promise<{
    readonly available: boolean;
    readonly lastBreakingAt: number | null;
    readonly cooldownEndsAt: number | null;
  }> {
    const lastBreaking = await this.deps.kv.get(BREAKING_KEY).catch(() => null);
    if (!lastBreaking) {
      return { available: true, lastBreakingAt: null, cooldownEndsAt: null };
    }
    const lastMs = Number(lastBreaking);
    const now = Date.now();
    const available = (now - lastMs) >= BREAKING_COOLDOWN_MS;
    return {
      available,
      lastBreakingAt: lastMs,
      cooldownEndsAt: available ? null : lastMs + BREAKING_COOLDOWN_MS,
    };
  }
}

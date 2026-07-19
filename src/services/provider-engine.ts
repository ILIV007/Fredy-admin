/**
 * src/services/provider-engine.ts
 * v11 Phase 3 — Intelligent Provider Engine.
 *
 * Responsibilities:
 *   - Determine which providers need refreshing (based on tier + last refresh + adaptive backoff)
 *   - Stagger refreshes to avoid API spikes (Cloudflare free-tier optimization)
 *   - Track provider health (success rate, latency, items accepted/rejected)
 *   - Apply adaptive refresh (backoff when a provider returns no useful content)
 *   - Compute provider reputation scores
 *
 * Design principles (Cloudflare free-tier):
 *   - NEVER fetch all providers at once
 *   - Refresh only providers whose interval has expired
 *   - Reuse cached results whenever possible
 *   - Keep KV operations minimal
 *   - Batch state updates
 *
 * See v11 Phase 3 spec.
 */

import type { Tier } from "../types/tier";
import { tierPriority } from "../types/tier";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";
import type { PluginManager } from "./plugin-manager";
import {
  ADAPTIVE_REFRESH_BACKOFF_MULTIPLIER,
  ADAPTIVE_REFRESH_EMPTY_THRESHOLD,
  ADAPTIVE_REFRESH_MAX_BACKOFF,
  PROVIDER_REPUTATION_DEFAULTS,
  TIER_S_REFRESH_HOURS,
  TIER_A_REFRESH_HOURS,
  TIER_B_REFRESH_HOURS,
  TIER_LEGACY_REFRESH_HOURS,
} from "../core/constants";

export interface ProviderEngineDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly pluginManager: PluginManager;
}

/** A provider that needs refreshing in the current tick. */
export interface DueProvider {
  readonly pluginId: string;
  readonly tier: Tier;
  readonly priority: number;
  readonly effectiveRefreshHours: number;
  readonly lastRefreshAt: number | null;
  readonly backoffMultiplier: number;
}

/** Provider analytics summary (for dashboard). */
export interface ProviderAnalytics {
  readonly pluginId: string;
  readonly tier: Tier;
  readonly enabled: boolean;
  readonly healthy: boolean;
  readonly acceptanceRate: number; // 0-1
  readonly totalAccepted: number;
  readonly totalRejected: number;
  readonly averageScore: number;
  readonly averageLatencyMs: number | null;
  readonly refreshIntervalHours: number;
  readonly currentBackoff: number;
  readonly estimatedApiUsage: number; // requests/day estimate
  readonly reputation: number;
}

/** Overall provider engine summary (for dashboard). */
export interface EngineSummary {
  readonly totalProviders: number;
  readonly enabledProviders: number;
  readonly healthyProviders: number;
  readonly dueForRefresh: number;
  readonly topPerforming: string | null;
  readonly worstPerforming: string | null;
  readonly estimatedDailyApiUsage: number;
  readonly byTier: Readonly<Record<Tier, { readonly total: number; readonly enabled: number; readonly due: number }>>;
}

const MS_PER_HOUR = 3600 * 1000;

export class ProviderEngine {
  constructor(private readonly deps: ProviderEngineDeps) {}

  /**
   * Determine which providers are due for refresh.
   * Only returns providers whose refresh interval (adjusted by backoff) has expired.
   */
  getDueProviders(now: number = Date.now()): readonly DueProvider[] {
    const plugins = this.deps.pluginManager.listEnabledByTier();
    const due: DueProvider[] = [];

    for (const plugin of plugins) {
      const status = this.deps.pluginManager.getStatus(plugin.metadata.id);
      const tier = plugin.getTier();
      const baseInterval = this.getRefreshInterval(tier);
      const backoff = status.currentBackoffMultiplier || 1;
      const effectiveInterval = baseInterval * backoff;
      const intervalMs = effectiveInterval * MS_PER_HOUR;

      const lastRefresh = status.lastRefreshAt;
      const isDue = lastRefresh === null || (now - lastRefresh) >= intervalMs;

      if (isDue) {
        due.push({
          pluginId: plugin.metadata.id,
          tier,
          priority: plugin.metadata.priority,
          effectiveRefreshHours: effectiveInterval,
          lastRefreshAt: lastRefresh,
          backoffMultiplier: backoff,
        });
      }
    }

    // Sort by tier priority, then by plugin priority
    due.sort((a, b) => {
      const tierDiff = tierPriority(a.tier) - tierPriority(b.tier);
      if (tierDiff !== 0) return tierDiff;
      return a.priority - b.priority;
    });

    return due;
  }

  /** Get the base refresh interval (in hours) for a tier. */
  private getRefreshInterval(tier: Tier): number {
    switch (tier) {
      case "S": return TIER_S_REFRESH_HOURS;
      case "A": return TIER_A_REFRESH_HOURS;
      case "B": return TIER_B_REFRESH_HOURS;
      case "legacy": return TIER_LEGACY_REFRESH_HOURS;
    }
  }

  /**
   * v11 Phase 3: Adaptive Refresh.
   * If a provider returns no useful content for N consecutive fetches,
   * increase its backoff multiplier (up to MAX_BACKOFF).
   * When quality improves, reset backoff to 1.
   */
  applyAdaptiveBackoff(pluginId: string, hadUsefulContent: boolean): void {
    const status = this.deps.pluginManager.getStatus(pluginId);
    let newBackoff = status.currentBackoffMultiplier || 1;

    if (!hadUsefulContent) {
      // Increment consecutive empty fetches
      const emptyCount = status.consecutiveEmptyFetches + 1;
      if (emptyCount >= ADAPTIVE_REFRESH_EMPTY_THRESHOLD) {
        newBackoff = Math.min(newBackoff * ADAPTIVE_REFRESH_BACKOFF_MULTIPLIER, ADAPTIVE_REFRESH_MAX_BACKOFF);
        this.deps.logger.warn("provider.adaptive_backoff", {
          pluginId,
          emptyCount,
          newBackoff,
          message: `Provider "${pluginId}" backed off to ${newBackoff}x`,
        });
      }
    } else {
      // Reset backoff on successful content
      if (newBackoff > 1) {
        newBackoff = 1;
        this.deps.logger.info("provider.adaptive_restore", {
          pluginId,
          message: `Provider "${pluginId}" backoff restored to 1x`,
        });
      }
    }

    this.deps.pluginManager.updateProviderStatus(pluginId, {
      currentBackoffMultiplier: newBackoff,
      lastRefreshAt: Date.now(),
    });
  }

  /** Get the reputation score for a provider. */
  getReputation(pluginId: string): number {
    return PROVIDER_REPUTATION_DEFAULTS[pluginId] ?? 60;
  }

  /** Compute analytics for a single provider. */
  getAnalytics(pluginId: string): ProviderAnalytics | null {
    const plugin = this.deps.pluginManager.get(pluginId);
    if (!plugin) return null;

    const status = this.deps.pluginManager.getStatus(pluginId);
    const tier = plugin.getTier();
    const totalAccepted = status.itemsAccepted;
    const totalRejected = status.itemsRejected;
    const total = totalAccepted + totalRejected;
    const acceptanceRate = total > 0 ? totalAccepted / total : 0;

    return {
      pluginId,
      tier,
      enabled: status.enabled,
      healthy: status.healthy,
      acceptanceRate,
      totalAccepted,
      totalRejected,
      averageScore: 0, // TODO: track rolling average
      averageLatencyMs: status.averageLatencyMs,
      refreshIntervalHours: this.getRefreshInterval(tier) * (status.currentBackoffMultiplier || 1),
      currentBackoff: status.currentBackoffMultiplier || 1,
      estimatedApiUsage: this.estimateDailyApiUsage(tier),
      reputation: this.getReputation(pluginId),
    };
  }

  /** Estimate daily API requests for a tier. */
  private estimateDailyApiUsage(tier: Tier): number {
    const intervalHours = this.getRefreshInterval(tier);
    return Math.ceil(24 / intervalHours);
  }

  /** Get the full engine summary for the dashboard. */
  getSummary(): EngineSummary {
    const all = this.deps.pluginManager.list();
    const due = this.getDueProviders();
    const dueIds = new Set(due.map((d) => d.pluginId));

    const byTier: Record<Tier, { total: number; enabled: number; due: number }> = {
      S: { total: 0, enabled: 0, due: 0 },
      A: { total: 0, enabled: 0, due: 0 },
      B: { total: 0, enabled: 0, due: 0 },
      legacy: { total: 0, enabled: 0, due: 0 },
    };

    let topPerformer: { id: string; score: number } | null = null;
    let worstPerformer: { id: string; score: number } | null = null;
    let totalApiUsage = 0;

    for (const plugin of all) {
      const tier = plugin.getTier();
      const status = this.deps.pluginManager.getStatus(plugin.metadata.id);
      byTier[tier].total++;
      if (status.enabled) byTier[tier].enabled++;
      if (dueIds.has(plugin.metadata.id)) byTier[tier].due++;

      if (status.enabled) {
        totalApiUsage += this.estimateDailyApiUsage(tier);

        // Track top/worst by acceptance rate
        const total = status.itemsAccepted + status.itemsRejected;
        const acceptanceRate = total > 0 ? status.itemsAccepted / total : 0;
        if (!topPerformer || acceptanceRate > topPerformer.score) {
          topPerformer = { id: plugin.metadata.id, score: acceptanceRate };
        }
        if (total > 0 && (!worstPerformer || acceptanceRate < worstPerformer.score)) {
          worstPerformer = { id: plugin.metadata.id, score: acceptanceRate };
        }
      }
    }

    return {
      totalProviders: all.length,
      enabledProviders: byTier.S.enabled + byTier.A.enabled + byTier.B.enabled + byTier.legacy.enabled,
      healthyProviders: all.filter((p) => this.deps.pluginManager.getStatus(p.metadata.id).healthy).length,
      dueForRefresh: due.length,
      topPerforming: topPerformer?.id ?? null,
      worstPerforming: worstPerformer?.id ?? null,
      estimatedDailyApiUsage: totalApiUsage,
      byTier,
    };
  }

  /**
   * v11 Phase 3: Staggered refresh.
   * Refresh due providers ONE AT A TIME, in priority order.
   * This avoids API rate-limit spikes and keeps CPU/KV usage low.
   */
  async refreshDueProviders(maxRefreshes: number = 3): Promise<{
    readonly refreshed: readonly string[];
    readonly skipped: readonly string[];
    readonly failed: readonly string[];
  }> {
    const due = this.getDueProviders().slice(0, maxRefreshes);
    const refreshed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    for (const provider of due) {
      try {
        const result = await this.deps.pluginManager.fetchWithQualityFilter(provider.pluginId);
        const hadContent = (result?.items.length ?? 0) > 0;
        this.applyAdaptiveBackoff(provider.pluginId, hadContent);

        if (hadContent) {
          refreshed.push(provider.pluginId);
        } else {
          skipped.push(provider.pluginId);
        }
      } catch (error) {
        failed.push(provider.pluginId);
        this.deps.logger.error("provider.refresh_failed", {
          pluginId: provider.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.deps.logger.info("provider.refresh_batch", {
      refreshed: refreshed.length,
      skipped: skipped.length,
      failed: failed.length,
      totalDue: due.length,
    });

    return { refreshed, skipped, failed };
  }
}

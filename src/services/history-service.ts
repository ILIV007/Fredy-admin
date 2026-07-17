/**
 * src/services/history-service.ts
 * Stores published post history.
 *
 * Records for each published post:
 *   - published time
 *   - plugin
 *   - category
 *   - language
 *   - quality score
 *   - message ID
 *   - AI provider/model
 *   - tokens used
 *   - estimated cost
 *   - text preview
 *   - source URL
 *
 * Stored in KV by date (fredy:history:<YYYY-MM-DD>).
 * 90-day TTL.
 *
 * See Prompt 9 spec.
 */

import { historyKey } from "../core/storage/keys";
import type { HistoryEntry, HistoryQueryResult } from "../types/scheduler";
import type { ReadyContent } from "../types/content";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";
import { formatDateInZone } from "../primitives/time";
import { truncate } from "../primitives/strings";

export interface HistoryServiceDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly timezone: () => Promise<string>;
}

const HISTORY_TTL_SECONDS = 90 * 24 * 3600; // 90 days
const MAX_ENTRIES_PER_DAY = 100;
/** TTL for the getRecent() in-memory cache (60s). Reduces KV reads when
 *  the dashboard/bot is opened repeatedly within a minute. */
const RECENT_CACHE_TTL_MS = 60_000;

export class HistoryService {
  /** In-memory cache for getRecent() — keyed by `days` arg. */
  private recentCache = new Map<number, { entries: readonly HistoryEntry[]; expiresAt: number }>();

  constructor(private readonly deps: HistoryServiceDeps) {}

  /** Record a successfully published post. */
  async recordPublished(
    content: ReadyContent,
    telegramMessageId: number,
    telegramChatId: string,
  ): Promise<HistoryEntry> {
    const timezone = await this.deps.timezone();
    const date = formatDateInZone(Date.now(), timezone);

    const entry: HistoryEntry = {
      id: content.id,
      publishedAt: Date.now(),
      pluginId: content.pluginId,
      category: content.category,
      language: content.language,
      qualityScore: content.quality.overallScore,
      telegramMessageId,
      telegramChatId,
      aiProvider: content.aiProvider,
      aiModel: content.aiModel,
      tokensUsed: content.tokensUsed,
      estimatedCost: content.estimatedCost,
      textPreview: truncate(content.text, 200),
      sourceUrl: content.sourceUrl,
    };

    const entries = await this.getEntriesForDate(date);
    entries.unshift(entry);

    // Cap entries per day.
    if (entries.length > MAX_ENTRIES_PER_DAY) {
      entries.length = MAX_ENTRIES_PER_DAY;
    }

    await this.deps.kv.setJson(historyKey(date), entries, HISTORY_TTL_SECONDS);

    this.deps.logger.info("pipeline.complete", {
      contentId: content.id,
      date,
      messageId: telegramMessageId,
      message: "Published post recorded in history",
    });

    this.invalidateRecentCache();
    return entry;
  }

  /** Record a failed publish attempt. */
  async recordFailed(content: ReadyContent, error: string): Promise<void> {
    const timezone = await this.deps.timezone();
    const date = formatDateInZone(Date.now(), timezone);

    const entry: HistoryEntry = {
      id: content.id,
      publishedAt: Date.now(),
      pluginId: content.pluginId,
      category: content.category,
      language: content.language,
      qualityScore: content.quality.overallScore,
      telegramMessageId: -1, // sentinel for failed
      telegramChatId: "",
      aiProvider: content.aiProvider,
      aiModel: content.aiModel,
      tokensUsed: content.tokensUsed,
      estimatedCost: content.estimatedCost,
      textPreview: truncate(error, 200),
      sourceUrl: content.sourceUrl,
    };

    const entries = await this.getEntriesForDate(date);
    entries.unshift(entry);

    if (entries.length > MAX_ENTRIES_PER_DAY) {
      entries.length = MAX_ENTRIES_PER_DAY;
    }

    await this.deps.kv.setJson(historyKey(date), entries, HISTORY_TTL_SECONDS);

    this.deps.logger.error("pipeline.error", {
      contentId: content.id,
      date,
      error,
      message: "Failed publish recorded in history",
    });

    this.invalidateRecentCache();
  }

  /** Get history for a specific date. */
  async getForDate(date: string): Promise<HistoryQueryResult> {
    const entries = await this.getEntriesForDate(date);
    return { entries, total: entries.length, date };
  }

  /** Get history for today. */
  async getToday(): Promise<HistoryQueryResult> {
    const timezone = await this.deps.timezone();
    const date = formatDateInZone(Date.now(), timezone);
    return this.getForDate(date);
  }

  /** Get recent history (last N days). */
  async getRecent(days = 7): Promise<readonly HistoryEntry[]> {
    // v7.4.0: In-memory cache for 60s — drastically reduces KV reads when
    // the dashboard or bot menu is opened repeatedly. The cache is keyed
    // by `days` and invalidated on recordPublished / recordFailed.
    const cached = this.recentCache.get(days);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }

    const timezone = await this.deps.timezone();
    const now = Date.now();
    const allEntries: HistoryEntry[] = [];

    for (let i = 0; i < days; i++) {
      const date = formatDateInZone(now - i * 24 * 3600 * 1000, timezone);
      const entries = await this.getEntriesForDate(date);
      allEntries.push(...entries);
    }

    // Sort by publishedAt descending.
    allEntries.sort((a, b) => b.publishedAt - a.publishedAt);

    // Cache the result.
    this.recentCache.set(days, { entries: allEntries, expiresAt: Date.now() + RECENT_CACHE_TTL_MS });
    return allEntries;
  }

  /** Invalidate the recent-history cache (called after recordPublished / recordFailed). */
  private invalidateRecentCache(): void {
    this.recentCache.clear();
  }

  /** Get stats for a date (for the dashboard). */
  async getStatsForDate(date: string): Promise<{
    readonly total: number;
    readonly published: number;
    readonly failed: number;
    readonly byCategory: Readonly<Record<string, number>>;
    readonly byPlugin: Readonly<Record<string, number>>;
    readonly avgQualityScore: number;
    readonly totalTokens: number;
    readonly totalCost: number;
  }> {
    const entries = await this.getEntriesForDate(date);
    const published = entries.filter((e) => e.telegramMessageId > 0).length;
    const failed = entries.filter((e) => e.telegramMessageId === -1).length;

    const byCategory: Record<string, number> = {};
    const byPlugin: Record<string, number> = {};
    let qualitySum = 0;
    let qualityCount = 0;
    let totalTokens = 0;
    let totalCost = 0;

    for (const entry of entries) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      byPlugin[entry.pluginId] = (byPlugin[entry.pluginId] ?? 0) + 1;
      if (entry.telegramMessageId > 0) {
        qualitySum += entry.qualityScore;
        qualityCount++;
      }
      totalTokens += entry.tokensUsed;
      totalCost += entry.estimatedCost;
    }

    return {
      total: entries.length,
      published,
      failed,
      byCategory,
      byPlugin,
      avgQualityScore: qualityCount > 0 ? Math.round(qualitySum / qualityCount) : 0,
      totalTokens,
      totalCost,
    };
  }

  /** Clear history for a date. */
  async clearForDate(date: string): Promise<void> {
    await this.deps.kv.delete(historyKey(date));
    this.invalidateRecentCache();
  }

  // ────────────────────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────────────────────

  private async getEntriesForDate(date: string): Promise<HistoryEntry[]> {
    const entries = await this.deps.kv.getJson<HistoryEntry[]>(historyKey(date));
    return entries ?? [];
  }
}

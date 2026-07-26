/**
 * src/services/novelty-score.ts
 * v13.0.6: Novelty Score — prevents publishing the same NEWS from different providers.
 *
 * Problem: Tom's Hardware, Ars Technica, and TechPowerUp may all cover
 * "RTX 6090 officially announced" within 24-48h. Without this filter,
 * three near-identical posts get published.
 *
 * Solution: Track "trend keys" (extracted hardware product names) of
 * published articles. When a new article arrives, check if its trend key
 * was already published within the novelty window (default 48h).
 *
 * - If NOT published before → high novelty (100) → publish.
 * - If published before but this article has HIGHER quality score →
 *   moderate novelty (50) → publish only if quality is significantly better.
 * - If published before and quality is similar or lower → low novelty (0) → reject.
 *
 * This is DIFFERENT from Dedup:
 * - Dedup prevents the SAME article (same URL/hash) from being published twice.
 * - Novelty Score prevents the SAME NEWS from different providers being published.
 *
 * KV-backed: trend keys stored in KV with 48h TTL. Survives across Worker restarts.
 */

import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

// ────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────

export interface NoveltyConfig {
  /** How long to remember published trend keys (hours). Default 48. */
  readonly noveltyWindowHours: number;
  /** Minimum quality advantage required to publish a "same news" article (0-100). Default 15. */
  readonly qualityAdvantageThreshold: number;
  /** Novelty score threshold for acceptance (0-100). Default 30. */
  readonly noveltyThreshold: number;
}

export const NOVELTY_DEFAULTS: NoveltyConfig = {
  noveltyWindowHours: 48,
  qualityAdvantageThreshold: 15,
  noveltyThreshold: 30,
} as const;

// ────────────────────────────────────────────────────────────
// Result
// ────────────────────────────────────────────────────────────

export interface NoveltyResult {
  /** Novelty score 0-100. 100 = completely new news. 0 = same news already published. */
  readonly noveltyScore: number;
  /** Whether the article should be published (noveltyScore >= threshold). */
  readonly accepted: boolean;
  /** The extracted trend key (hardware product name or first 5 words). */
  readonly trendKey: string;
  /** Whether this trend key was seen before (published within window). */
  readonly isDuplicateNews: boolean;
  /** Previous quality score if seen before (null if first time). */
  readonly previousQualityScore: number | null;
  /** Reason for the decision. */
  readonly reason: string;
}

// ────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────

const KV_KEY_PREFIX = "fredy:novelty:trend:";
const KV_TTL_SECONDS = 48 * 3600; // 48 hours

export interface NoveltyScoreDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
  readonly config: () => Promise<NoveltyConfig>;
}

interface TrendEntry {
  readonly trendKey: string;
  readonly qualityScore: number;
  readonly provider: string;
  readonly title: string;
  readonly publishedAt: number;
}

export class NoveltyScore {
  constructor(private readonly deps: NoveltyScoreDeps) {}

  /**
   * Check the novelty of an article. Call AFTER quality scoring but BEFORE AI generation.
   *
   * @param title Article title
   * @param provider Provider ID (e.g., "toms-hardware")
   * @param qualityScore The quality score from TierHFilter (0-100)
   * @returns NoveltyResult with noveltyScore and accepted flag
   */
  async check(title: string, provider: string, qualityScore: number): Promise<NoveltyResult> {
    const config = await this.deps.config();
    const trendKey = this.extractTrendKey(title);
    const kvKey = `${KV_KEY_PREFIX}${this.hashKey(trendKey)}`;

    // Check if this trend key was already published
    const existing = await this.deps.kv.getJson<TrendEntry>(kvKey).catch(() => null);

    if (!existing) {
      // First time seeing this news → high novelty
      const result: NoveltyResult = {
        noveltyScore: 100,
        accepted: true,
        trendKey,
        isDuplicateNews: false,
        previousQualityScore: null,
        reason: "New news (not seen before in novelty window)",
      };
      this.deps.logger.info("novelty_score", {
        provider, title: title.slice(0, 100), trendKey,
        noveltyScore: 100, accepted: true,
        message: `[NOVELTY] ${provider} | Score:100 | NEW | ${trendKey} | ${title.slice(0, 60)}`,
      });
      return result;
    }

    // Same news was already published — check if this version is significantly better
    const qualityAdvantage = qualityScore - existing.qualityScore;
    const isSignificantlyBetter = qualityAdvantage >= config.qualityAdvantageThreshold;

    // Calculate novelty score
    let noveltyScore: number;
    let accepted: boolean;
    let reason: string;

    if (isSignificantlyBetter) {
      // This article is significantly better quality → moderate novelty
      noveltyScore = 50;
      accepted = noveltyScore >= config.noveltyThreshold;
      reason = `Same news but +${qualityAdvantage} quality advantage over ${existing.provider} (prev: ${existing.qualityScore}, new: ${qualityScore})`;
    } else {
      // Same news, similar or lower quality → low novelty
      noveltyScore = 0;
      accepted = false;
      reason = `Duplicate news from ${existing.provider} (prev quality: ${existing.qualityScore}, new: ${qualityScore}, need +${config.qualityAdvantageThreshold})`;
    }

    const result: NoveltyResult = {
      noveltyScore,
      accepted,
      trendKey,
      isDuplicateNews: true,
      previousQualityScore: existing.qualityScore,
      reason,
    };

    this.deps.logger.info("novelty_score", {
      provider, title: title.slice(0, 100), trendKey,
      noveltyScore, accepted,
      previousProvider: existing.provider,
      previousQuality: existing.qualityScore,
      newQuality: qualityScore,
      qualityAdvantage,
      message: `[NOVELTY] ${provider} | Score:${noveltyScore} | ${accepted ? "ACCEPTED" : "REJECTED"} | ${trendKey} | ${title.slice(0, 60)}`,
    });

    return result;
  }

  /**
   * Record that an article was published. Call AFTER successful publish.
   * Stores the trend key in KV with TTL = noveltyWindowHours.
   *
   * If the article has a HIGHER quality score than the existing entry,
   * update the entry (so future articles need to beat the best version).
   */
  async recordPublished(title: string, provider: string, qualityScore: number): Promise<void> {
    const trendKey = this.extractTrendKey(title);
    const kvKey = `${KV_KEY_PREFIX}${this.hashKey(trendKey)}`;
    const existing = await this.deps.kv.getJson<TrendEntry>(kvKey).catch(() => null);

    // Only update if this is new OR has higher quality score
    if (!existing || qualityScore > existing.qualityScore) {
      const entry: TrendEntry = {
        trendKey,
        qualityScore,
        provider,
        title: title.slice(0, 200),
        publishedAt: Date.now(),
      };
      await this.deps.kv.setJson(kvKey, entry, KV_TTL_SECONDS).catch((e) => {
        this.deps.logger.warn("novelty_score", { error: String(e), message: "Failed to record novelty trend" });
      });
    }
  }

  /**
   * Extract a "trend key" from the title — used to detect when multiple
   * providers cover the same news event. ONLY extracts the hardware product
   * name (e.g., "rtx 5090", "ryzen 9 9950x") — NOT the full title.
   * This way, "RTX 5090 Officially Announced" and "RTX 5090 Launch: Specs"
   * both produce the same trend key: "rtx 5090".
   */
  private extractTrendKey(title: string): string {
    const lower = title.toLowerCase();

    // Try to extract hardware product names (return ONLY the product name)
    const patterns: RegExp[] = [
      // GPU: RTX 5090 (just the model number, not trailing words)
      /\b(rtx\s*\d+)/i,
      // RX 7900 XTX
      /\b(rx\s*\d+)/i,
      // Ryzen 9 9950X
      /\b(ryzen\s*\d+)/i,
      // Intel Core Ultra 9
      /\b(core\s*ultra\s*\d+)/i,
      // Core i9
      /\b(core\s*i\d+)/i,
      // Apple: M4, M3 (just the chip generation)
      /\b(m[1-9])\b/i,
      // EPYC, Threadripper, Xeon, Arc (just the brand)
      /\b(epyc)\b/i,
      /\b(threadripper)\b/i,
      /\b(xeon)\b/i,
      /\b(arc\s*\w+)/i,
      // DDR5, DDR6
      /\b(ddr[56])\b/i,
      // PCIe Gen5
      /\b(pcie\s*gen[56])\b/i,
      // Snapdragon
      /\b(snapdragon\s*\w+)/i,
      // Exynos
      /\b(exynos\s*\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(lower);
      if (match) {
        // Return the full match (pattern + capture) normalized
        const full = match[0].replace(/\s+/g, " ").trim();
        return full;
      }
    }

    // Fall back to first 5 significant words (skip common words)
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used", "of", "to", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "not", "only", "own", "same", "so", "than", "too", "very", "just", "also", "now", "and", "but", "or", "nor", "if", "because", "while", "this", "that", "these", "those", "what", "which", "who", "whom", "whose", "its"]);
    const words = lower.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
    return words.slice(0, 5).join(" ") || lower.slice(0, 30);
  }

  /** Simple hash for KV key (avoids long keys). */
  private hashKey(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  /** Clear all novelty records (for debugging/testing). */
  async clearAll(): Promise<void> {
    const keys = await this.deps.kv.list(KV_KEY_PREFIX).catch(() => []);
    for (const key of keys) {
      await this.deps.kv.delete(key).catch(() => {});
    }
  }
}

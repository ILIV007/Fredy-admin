/**
 * src/services/tier-h-filter.ts
 * v13.0.3: Tier H News Intelligence Filter.
 *
 * Every Tier H article receives a quality score from 0–100.
 * Only articles with score >= threshold (default 70) enter the AI pipeline.
 */

import type { SourceItem } from "../types/api";
import type { Logger } from "./logger";

export interface TierHFilterConfig {
  readonly threshold: number;
  readonly positiveWeight: number;
  readonly negativeWeight: number;
  readonly recentBonus: number;
  readonly trendBonus: number;
  readonly clickbaitPenalty: number;
  readonly maxScore: number;
  readonly minScore: number;
}

export const TIER_H_FILTER_DEFAULTS: TierHFilterConfig = {
  threshold: 50, // v13.3.6: lowered from 70 — was rejecting all Ars Technica tech news
  positiveWeight: 15,
  negativeWeight: 15,
  recentBonus: 10,
  trendBonus: 20,
  clickbaitPenalty: 100, // v13.3.6: hard reject — clickbait always gets -100
  maxScore: 100,
  minScore: 0,
} as const;

const POSITIVE_SIGNALS: readonly string[] = [
  "rtx", "rx 7", "rx 9", "intel arc", "gpu launch", "gpu generation",
  "new gpu", "graphics card launch", "radeon", "geforce",
  "ryzen", "threadripper", "intel core ultra", "cpu launch",
  "new cpu", "processor launch", "epyc", "xeon",
  "apple silicon", "m1", "m2", "m3", "m4", "a17", "a18", "apple chip",
  "benchmark", "performance comparison", "gaming benchmark",
  "ai hardware", "npu", "tensor", "cuda", "rocm", "ai accelerator",
  "ai chip", "inference", "training chip",
  "new architecture", "new process node", "tsmc", "samsung foundry",
  "3nm", "2nm", "4nm", "5nm",
  "pcie gen5", "pcie gen6", "ddr6", "hbm", "ssd technology",
  "server hardware", "datacenter", "ai accelerator",
  "chip announcement", "flagship motherboard", "large hardware leak",
  "official launch", "release date", "availability",
  "major security vulnerability", "large recall",
  "major pricing announcement", "market-changing product",
  "industry partnership", "technology breakthrough", "record performance",
  "large driver improvement", "major bios update",
  // v13.3.6: Broader tech news signals — Ars Technica / Tom's Hardware post
  // legitimate tech news that doesn't always contain hardware keywords.
  // NOTE: Individual company names (nvidia, intel, apple, etc.) are NOT
  // included because they match too broadly (even minor driver updates
  // about NVIDIA would get positive bonus). Instead, we use tech TOPICS.
  "ai", "artificial intelligence", "machine learning", "llm", "gpt",
  "openai", "cybersecurity", "vulnerability", "exploit", "ransomware",
  "data breach", "privacy", "encryption",
  "self-driving", "autonomous", "ev", "electric vehicle",
  "spacex", "rocket", "satellite",
  "quantum computing",
  "blockchain", "cryptocurrency", "bitcoin",
  "antitrust", "lawsuit", "patent",
  "merger", "acquisition", "ipo",
  "open source",
  "cloud", "aws", "azure",
  "5g", "6g", "fiber", "broadband",
  "battery technology", "solar", "renewable",
  "robotics", "drone", "automation",
  "virtual reality", "augmented reality",
  "game engine", "steam deck",
  "netflix", "spotify", "youtube",
  "social media",
] as const;

const NEGATIVE_SIGNALS: readonly string[] = [
  "small software update", "minor driver version", "tiny firmware patch",
  "firmware patch", "minor driver",
  "editorial opinion", "opinion article", "opinion:", "our thoughts",
  "buying guide", "should you buy", "best ", "top 10", "top 5",
  "review repost", "weekly digest", "old recap", "recap",
  "minor discount", "small promotion", "regional availability",
  "case mod", "wallpaper", "accessory", "mouse", "keyboard",
  "merchandise", "cosmetic update",
  "interview without technical",
  "rumor with no evidence", "rumor:", "leaked spec",
  // v13.3.6: Deal/promo/sale patterns — reject shopping content.
  "save $", "save usd", "deal:", "deals:", "on sale", "price drop",
  "discount:", "discounted", "lowest price", "cheapest",
  "black friday", "cyber monday", "prime day",
  "coupon", "promo code", "refurbished",
  "save up to", "off at", "off msrp",
  "where to buy", "how to buy", "pre-order now",
  "in stock", "back in stock", "restock",
] as const;

const CLICKBAIT_PATTERNS: readonly RegExp[] = [
  /^everything you need to know/i,
  /^best\b/i,
  /^our thoughts/i,
  /^opinion:/i,
  /^should you buy/i,
  /^the ultimate guide/i,
  /^\d+ (best|top|must-have)/i,
  // v13.3.6: Deal clickbait
  /^save \$\d+/i,
  /^deal:/i,
  /^deals:/i,
] as const;

const LAUNCH_WORDS: readonly string[] = [
  "released", "announces", "announced", "launch", "launches",
  "introduces", "official", "now available",
  "first look", "hands-on", "breaking",
] as const;

export interface TierHScoreResult {
  readonly score: number;
  readonly accepted: boolean;
  readonly reasons: readonly string[];
  readonly positiveMatches: readonly string[];
  readonly negativeMatches: readonly string[];
  readonly isRecent: boolean;
  readonly isClickbait: boolean;
  readonly hasLaunchWord: boolean;
  readonly provider: string;
  readonly title: string;
}

export interface TierHFilterDeps {
  readonly logger: Logger;
  readonly config: () => Promise<TierHFilterConfig>;
}

export class TierHFilter {
  private recentTitles: Map<string, { providers: Set<string>; timestamp: number }> = new Map();
  private readonly RECENT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly deps: TierHFilterDeps) {}

  async score(item: SourceItem): Promise<TierHScoreResult> {
    const config = await this.deps.config();
    const title = item.title ?? "";
    const body = item.body ?? "";
    const text = `${title} ${body}`.toLowerCase();
    const titleLower = title.toLowerCase();

    const positiveMatches: string[] = POSITIVE_SIGNALS.filter((s) => text.includes(s));
    const negativeMatches: string[] = NEGATIVE_SIGNALS.filter((s) => text.includes(s));
    const publishedAt = item.publishedAt ?? Date.now();
    const ageMs = Date.now() - publishedAt;
    const isRecent = ageMs < 24 * 60 * 60 * 1000;
    const hasLaunchWord = LAUNCH_WORDS.some((w) => titleLower.includes(w));
    const isClickbait = CLICKBAIT_PATTERNS.some((re) => re.test(title));
    const trendKey = this.extractTrendKey(title);
    const isTrending = this.checkTrend(trendKey, item.source);

    const reasons: string[] = [];
    let score = 50;

    if (positiveMatches.length > 0) {
      const bonus = positiveMatches.length * config.positiveWeight;
      score += bonus;
      reasons.push(`+${bonus} positive (${positiveMatches.length})`);
      for (const m of positiveMatches.slice(0, 5)) reasons.push(`  +${config.positiveWeight} ${m}`);
    }
    if (negativeMatches.length > 0) {
      const penalty = negativeMatches.length * config.negativeWeight;
      score -= penalty;
      reasons.push(`-${penalty} negative (${negativeMatches.length})`);
      for (const m of negativeMatches.slice(0, 5)) reasons.push(`  -${config.negativeWeight} ${m}`);
    }
    if (isRecent) { score += config.recentBonus; reasons.push(`+${config.recentBonus} recent`); }
    if (hasLaunchWord) { score += config.recentBonus; reasons.push(`+${config.recentBonus} launch word`); }
    if (isTrending) { score += config.trendBonus; reasons.push(`+${config.trendBonus} trending`); }
    if (isClickbait) { score -= config.clickbaitPenalty; reasons.push(`-${config.clickbaitPenalty} clickbait`); }

    score = Math.max(config.minScore, Math.min(config.maxScore, score));
    this.recordTitle(trendKey, item.source, publishedAt);
    this.cleanupOldTitles();

    const accepted = score >= config.threshold;
    const result: TierHScoreResult = {
      score, accepted, reasons, positiveMatches, negativeMatches,
      isRecent, isClickbait, hasLaunchWord, provider: item.source, title,
    };

    this.deps.logger.info("tier_h_filter", {
      provider: item.source,
      title: title.slice(0, 100),
      score, threshold: config.threshold, accepted,
      positiveMatches: positiveMatches.length, negativeMatches: negativeMatches.length,
      isRecent, isClickbait, isTrending,
      message: `[TIER_H_FILTER] ${item.source} | Score:${score} | ${accepted ? "ACCEPTED" : "REJECTED"} | ${title.slice(0, 60)}`,
    });

    return result;
  }

  private extractTrendKey(title: string): string {
    const lower = title.toLowerCase();
    const hwMatch = lower.match(/(rtx\s*\d+|rx\s*\d+|ryzen\s*\d+|core\s*ultra\s*\d+|arc\s*\w+|epyc\s*\w+|threadripper\s*\w+)/i);
    if (hwMatch) return hwMatch[1]!.replace(/\s+/g, " ").trim();
    return lower.split(/\s+/).slice(0, 5).join(" ");
  }

  private recordTitle(key: string, provider: string, timestamp: number): void {
    const existing = this.recentTitles.get(key);
    if (existing) { existing.providers.add(provider); existing.timestamp = timestamp; }
    else { this.recentTitles.set(key, { providers: new Set([provider]), timestamp }); }
  }

  private checkTrend(key: string, currentProvider: string): boolean {
    const entry = this.recentTitles.get(key);
    if (!entry) return false;
    return entry.providers.size >= 2 && entry.providers.has(currentProvider);
  }

  private cleanupOldTitles(): void {
    const now = Date.now();
    for (const [key, entry] of this.recentTitles) {
      if (now - entry.timestamp > this.RECENT_TTL_MS) this.recentTitles.delete(key);
    }
  }

  async getThreshold(): Promise<number> {
    return (await this.deps.config()).threshold;
  }
}

export function scoreTierHArticle(
  title: string,
  body: string,
  publishedAt: number,
  config: TierHFilterConfig = TIER_H_FILTER_DEFAULTS,
): { score: number; accepted: boolean; positiveMatches: string[]; negativeMatches: string[]; isRecent: boolean; isClickbait: boolean; hasLaunchWord: boolean } {
  const text = `${title} ${body}`.toLowerCase();
  const titleLower = title.toLowerCase();
  const positiveMatches = POSITIVE_SIGNALS.filter((s) => text.includes(s));
  const negativeMatches = NEGATIVE_SIGNALS.filter((s) => text.includes(s));
  const ageMs = Date.now() - publishedAt;
  const isRecent = ageMs < 24 * 60 * 60 * 1000;
  const hasLaunchWord = LAUNCH_WORDS.some((w) => titleLower.includes(w));
  const isClickbait = CLICKBAIT_PATTERNS.some((re) => re.test(title));

  let score = 50;
  score += positiveMatches.length * config.positiveWeight;
  score -= negativeMatches.length * config.negativeWeight;
  if (isRecent) score += config.recentBonus;
  if (hasLaunchWord) score += config.recentBonus;
  if (isClickbait) score -= config.clickbaitPenalty;
  score = Math.max(config.minScore, Math.min(config.maxScore, score));

  return { score, accepted: score >= config.threshold, positiveMatches: [...positiveMatches], negativeMatches: [...negativeMatches], isRecent, isClickbait, hasLaunchWord };
}

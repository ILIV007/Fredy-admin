/**
 * src/services/quality-engine.ts
 * Scores generated posts on 6 dimensions, computes an overall score (0-100).
 *
 * Dimensions:
 *   - technicalValue  (weight 0.25) — preserves technical accuracy, links, code
 *   - readability      (weight 0.20) — paragraph structure, length, scannability
 *   - novelty          (weight 0.15) — is this new/interesting, not a duplicate
 *   - channelFit       (weight 0.15) — fits ILIVIR3's developer audience
 *   - spamDetection    (weight 0.15) — absence of spam/promo patterns
 *   - aiConfidence     (weight 0.10) — AI's self-assessed confidence
 *
 * Overall score = weighted average. Below minScore (default 60) → reject.
 * Hard rejects (empty, wrong language, broken HTML) bypass scoring.
 *
 * See FREDY_GUIDELINES.md §9.
 */

import type {
  DimensionScore,
  QualityDimension,
  QualityResult,
  QualityEngineOptions,
} from "../types/quality";
import {
  DEFAULT_QUALITY_WEIGHTS,
} from "../types/quality";
import type { AIGeneratedContent } from "../types/ai";
import type { SourceItem } from "../types/api";
import type { Category } from "../types/category";
import type { Logger } from "./logger";

export interface QualityEngineDeps {
  readonly logger: Logger;
}

export interface QualityEvaluationInput {
  readonly content: AIGeneratedContent;
  readonly sourceItem: SourceItem;
  readonly category: Category;
  readonly options: QualityEngineOptions;
}

export class QualityEngine {
  constructor(private readonly deps: QualityEngineDeps) {}

  /** Evaluate a generated post. Returns the full quality result. */
  async evaluate(input: QualityEvaluationInput): Promise<QualityResult> {
    const { content, sourceItem, category, options } = input;

    // Hard rejects — short-circuit.
    const hardReject = this.checkHardRejects(content, options);
    if (hardReject) {
      return {
        passed: false,
        overallScore: 0,
        dimensionScores: [],
        hardReject: true,
        hardRejectReason: hardReject.reason,
        minScore: options.minScore,
      };
    }

    // Score each dimension.
    const dimensionScores: DimensionScore[] = [];
    const weights = { ...DEFAULT_QUALITY_WEIGHTS, ...options.weights };

    dimensionScores.push(this.scoreTechnicalValue(content, sourceItem, weights.technicalValue));
    dimensionScores.push(this.scoreReadability(content, weights.readability));
    dimensionScores.push(this.scoreNovelty(content, options, weights.novelty));
    dimensionScores.push(this.scoreChannelFit(content, category, weights.channelFit));
    dimensionScores.push(this.scoreSpamDetection(content, options, weights.spamDetection));
    dimensionScores.push(this.scoreAIConfidence(content, weights.aiConfidence));

    // Compute overall = weighted average.
    const overallScore = Math.round(
      dimensionScores.reduce((sum, ds) => sum + ds.score * ds.weight, 0) /
        dimensionScores.reduce((sum, ds) => sum + ds.weight, 0),
    );

    const passed = overallScore >= options.minScore;

    if (!passed) {
      this.deps.logger.warn("quality.reject", {
        overallScore,
        minScore: options.minScore,
        category,
        source: sourceItem.source,
      });
    }

    return {
      passed,
      overallScore,
      dimensionScores,
      hardReject: false,
      minScore: options.minScore,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Hard rejects
  // ────────────────────────────────────────────────────────────

  private checkHardRejects(
    content: AIGeneratedContent,
    options: QualityEngineOptions,
  ): { reason: string } | null {
    // Empty text.
    if (!content.text || content.text.trim().length === 0) {
      return { reason: "Empty text" };
    }

    // Too short.
    if (content.text.trim().length < 20) {
      return { reason: `Text too short (${content.text.trim().length} chars)` };
    }

    // Wrong language (if rejectWrongLanguage is on).
    if (
      options.requestedLanguage &&
      content.generatedLanguage !== options.requestedLanguage
    ) {
      return {
        reason: `Language mismatch: expected "${options.requestedLanguage}", got "${content.generatedLanguage}"`,
      };
    }

    // AI refusal (aiConfidence = 0 usually means refusal).
    if (content.aiConfidence === 0) {
      return { reason: "AI confidence is 0 (likely refusal)" };
    }

    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Dimension scorers
  // ────────────────────────────────────────────────────────────

  /** Technical Value: did the AI preserve links, code, and technical terms? */
  private scoreTechnicalValue(
    content: AIGeneratedContent,
    sourceItem: SourceItem,
    weight: number,
  ): DimensionScore {
    let score = 100;
    const reasons: string[] = [];

    // v8.1.1: Removed the "source URL not preserved" penalty.
    // The source URL is NOT supposed to be in the AI-generated body text —
    // the UX layer adds it as a blockquote below the body. Penalizing for
    // this was causing NewsAPI posts (and others) to lose 30 points unfairly,
    // often pushing their score below the threshold.

    // Check for code blocks (if source had code).
    if (sourceItem.body && sourceItem.body.includes("```")) {
      if (!content.text.includes("```") && !content.text.includes("`")) {
        score -= 20;
        reasons.push("code blocks dropped");
      }
    }

    // Penalize if text is suspiciously short (may have lost technical detail).
    // v8.1.1: Only penalize if source body was substantial (>200 chars).
    // Short source bodies (like NewsAPI descriptions ~100 chars) shouldn't
    // be penalized for producing equally short output.
    if (sourceItem.body && sourceItem.body.length > 200) {
      if (content.text.length < sourceItem.body.length * 0.3) {
        score -= 25;
        reasons.push("text much shorter than source — may have lost detail");
      }
    }

    return {
      dimension: "technicalValue",
      score: Math.max(0, score),
      weight,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
  }

  /** Readability: paragraph structure, length, scannability. */
  private scoreReadability(content: AIGeneratedContent, weight: number): DimensionScore {
    let score = 100;
    const reasons: string[] = [];
    const text = content.text;

    // Check paragraph count.
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 1 && text.length > 500) {
      score -= 20;
      reasons.push("single long paragraph — hard to scan");
    }

    // Check for very long lines.
    const lines = text.split("\n");
    const longLines = lines.filter((l) => l.length > 300).length;
    if (longLines > 0) {
      score -= 15;
      reasons.push(`${longLines} very long lines`);
    }

    // Check for ALL CAPS (shouting).
    if (text.toUpperCase() === text && text.length > 50) {
      score -= 25;
      reasons.push("all caps");
    }

    // Length check.
    if (text.length > 4000) {
      score -= 20;
      reasons.push("near Telegram limit — may need trimming");
    }

    return {
      dimension: "readability",
      score: Math.max(0, score),
      weight,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
  }

  /** Novelty: is this new, or a duplicate of recent posts? */
  private scoreNovelty(
    content: AIGeneratedContent,
    options: QualityEngineOptions,
    weight: number,
  ): DimensionScore {
    let score = 100;
    const reasons: string[] = [];

    // Check dedup hashes.
    if (options.rejectDuplicates && options.recentHashes.length > 0) {
      const hash = this.computeHash(content.text);
      if (options.recentHashes.includes(hash)) {
        score -= 80;
        reasons.push("duplicate of recent post");
      }
    }

    // Penalize generic filler.
    const genericPhrases = [
      "in this article",
      "in this post",
      "today we will",
      "let's dive in",
      "without further ado",
    ];
    const lower = content.text.toLowerCase();
    for (const phrase of genericPhrases) {
      if (lower.includes(phrase)) {
        score -= 10;
        reasons.push(`generic phrase: "${phrase}"`);
      }
    }

    return {
      dimension: "novelty",
      score: Math.max(0, score),
      weight,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
  }

  /** Channel Fit: does this fit ILIVIR3's developer audience? */
  private scoreChannelFit(
    content: AIGeneratedContent,
    category: Category,
    weight: number,
  ): DimensionScore {
    let score = 100;
    const reasons: string[] = [];
    const lower = content.text.toLowerCase();

    // Category-specific checks.
    if (category === "B") {
      // News should not be political.
      const politicalKeywords = ["election", "president", "government policy", "parliament"];
      for (const kw of politicalKeywords) {
        if (lower.includes(kw)) {
          score -= 40;
          reasons.push(`political keyword in news: "${kw}"`);
        }
      }
    }

    if (category === "C") {
      // NASA should mention space/image.
      const spaceKeywords = ["space", "galaxy", "star", "planet", "nasa", "astronomy", "telescope"];
      const hasSpace = spaceKeywords.some((kw) => lower.includes(kw));
      if (!hasSpace && content.text.includes("NASA") === false) {
        score -= 20;
        reasons.push("NASA post doesn't mention space");
      }
    }

    // Developer relevance (all categories).
    const devKeywords = [
      "code", "api", "github", "developer", "programming", "software",
      "algorithm", "framework", "library", "javascript", "python", "rust",
      "ai", "ml", "model", "deploy", "server", "cloud", "worker",
    ];
    const hasDevRelevance = devKeywords.some((kw) => lower.includes(kw));
    if (!hasDevRelevance && category === "A") {
      score -= 30;
      reasons.push("Category A post lacks developer relevance");
    }

    return {
      dimension: "channelFit",
      score: Math.max(0, score),
      weight,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
  }

  /** Spam Detection: absence of spam/promo patterns. */
  private scoreSpamDetection(
    content: AIGeneratedContent,
    _options: QualityEngineOptions,
    weight: number,
  ): DimensionScore {
    void _options;
    let score = 100;
    const reasons: string[] = [];
    const lower = content.text.toLowerCase();

    // Spam phrases.
    const spamPhrases = [
      "join ", "subscribe", "follow us", "don't miss", "limited time",
      "click here", "buy now", "dm me", "order now", "act now",
    ];
    for (const phrase of spamPhrases) {
      if (lower.includes(phrase)) {
        score -= 30;
        reasons.push(`spam phrase: "${phrase}"`);
      }
    }

    // Attribution tags.
    const attributionPatterns = [/via @\w+/i, /source: @\w+/i, /\| @\w+$/im];
    for (const pattern of attributionPatterns) {
      if (pattern.test(content.text)) {
        score -= 25;
        reasons.push(`attribution tag: ${pattern.source}`);
      }
    }

    // Excessive hashtags (5+ consecutive).
    const hashtagSpam = /(?:#\w+\s*){5,}/.test(content.text);
    if (hashtagSpam) {
      score -= 40;
      reasons.push("hashtag spam (5+ consecutive)");
    }

    // t.me links to other channels.
    const tmeLinks = content.text.match(/t\.me\/\w+/gi);
    if (tmeLinks && tmeLinks.length > 0) {
      score -= 20;
      reasons.push(`${tmeLinks.length} t.me link(s) to other channels`);
    }

    return {
      dimension: "spamDetection",
      score: Math.max(0, score),
      weight,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
  }

  /** AI Confidence: the AI's self-assessed confidence (0-100). */
  private scoreAIConfidence(content: AIGeneratedContent, weight: number): DimensionScore {
    return {
      dimension: "aiConfidence",
      score: Math.max(0, Math.min(100, content.aiConfidence)),
      weight,
      reason: content.aiConfidence < 50 ? "AI reported low confidence" : undefined,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  /** Compute a dedup hash for a text (first 200 chars, normalized). */
  private computeHash(text: string): string {
    const normalized = text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[\u{1F000}-\u{1FAFF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    // Simple hash (not cryptographic — for dedup only).
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return String(hash);
  }

  /** Get the list of all dimension names. */
  static getDimensions(): readonly QualityDimension[] {
    return ["technicalValue", "readability", "novelty", "channelFit", "spamDetection", "aiConfidence"];
  }
}

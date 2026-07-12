/**
 * src/types/quality.ts
 * Quality engine types. See FREDY_GUIDELINES.md §9.
 */

import type { Post } from "./post";

/** The six quality dimensions. */
export type QualityDimension =
  | "technicalValue"
  | "readability"
  | "novelty"
  | "channelFit"
  | "spamDetection"
  | "aiConfidence";

/** Score for a single dimension (0-100). */
export interface DimensionScore {
  readonly dimension: QualityDimension;
  readonly score: number;
  readonly weight: number;
  readonly reason?: string;
}

/** Overall quality result for a generated post. */
export interface QualityResult {
  readonly passed: boolean;
  readonly overallScore: number;
  readonly dimensionScores: readonly DimensionScore[];
  readonly hardReject: boolean;
  readonly hardRejectReason?: string;
  readonly minScore: number;
}

/** Configuration for the quality engine at runtime. */
export interface QualityEngineOptions {
  readonly minScore: number;
  readonly rejectDuplicates: boolean;
  readonly duplicateTtlHours: number;
  readonly recentHashes: readonly string[];
  readonly requestedLanguage: string;
  readonly weights?: Partial<Record<QualityDimension, number>>;
}

/** Default weights for each dimension (must sum to 1.0). */
export const DEFAULT_QUALITY_WEIGHTS: Readonly<Record<QualityDimension, number>> = {
  technicalValue: 0.25,
  readability: 0.20,
  novelty: 0.15,
  channelFit: 0.15,
  spamDetection: 0.15,
  aiConfidence: 0.10,
};

/** A dedup hash with metadata. */
export interface DedupEntry {
  readonly hash: string;
  readonly postId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Re-export QualityCheck / QualityCheckContext / QualityCheckResult from plugin.ts. */
export type {
  QualityCheck,
  QualityCheckContext,
  QualityCheckResult,
} from "./plugin";

/** Re-export Post for consumers. */
export type { Post };

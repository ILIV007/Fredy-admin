/**
 * src/types/ai.ts
 * AI provider request/response shapes, generation result, and quality scoring.
 */

import type { Category } from "./category";
import type { SourceItem } from "./api";
import type { Soul } from "../services/soul-loader";

// ────────────────────────────────────────────────────────────
// Low-level provider request/response
// ────────────────────────────────────────────────────────────

/** A request to an AI provider. */
export interface AICompleteRequest {
  readonly system: string;
  readonly user: string;
  readonly jsonMode?: boolean;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly model?: string;
}

/** A successful response from an AI provider. */
export interface AICompleteResponse {
  readonly ok: true;
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly tokensUsed?: number;
  readonly latencyMs: number;
}

/** A failed response from an AI provider. */
export interface AICompleteError {
  readonly ok: false;
  readonly provider: string;
  readonly model: string;
  readonly error: string;
  readonly aborted: boolean;
}

/** Union result type. */
export type AIResult = AICompleteResponse | AICompleteError;

// ────────────────────────────────────────────────────────────
// High-level generation
// ────────────────────────────────────────────────────────────

/** Parameters for the high-level AIService.generate() call. */
export interface GenerateRequest {
  readonly category: Category;
  readonly source: string;
  readonly raw: SourceItem;
  readonly language: string;
  readonly soul: Soul;
  readonly promptProfile?: "default" | "concise" | "detailed";
}

/**
 * The AI's structured response. The AI is asked to return JSON with this shape.
 * The ResponseParser validates and extracts these fields.
 */
export interface AIGeneratedContent {
  /** The generated post text (Telegram HTML-ready, before formatter). */
  readonly text: string;
  /** AI self-assessed confidence (0-100). */
  readonly aiConfidence: number;
  /** Language the AI actually generated in (for verification). */
  readonly generatedLanguage: string;
  /** AI-suggested title/headline (optional, used by formatter). */
  readonly headline?: string;
  /** AI-extracted key points (optional, used by formatter). */
  readonly keyPoints?: readonly string[];
  /** AI note about any concerns (e.g., "could not verify X"). */
  readonly notes?: string;
}

/** Result of AIService.generate() — what the pipeline receives. */
export interface GenerateResult {
  readonly ok: boolean;
  readonly content: AIGeneratedContent | null;
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly tokensUsed: number;
  readonly estimatedCost: number;
  readonly attempts: readonly GenerateAttempt[];
  readonly error?: string;
}

/** Record of one attempt (for the trace and debug dashboard). */
export interface GenerateAttempt {
  readonly provider: string;
  readonly model: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
  readonly aborted: boolean;
}

// ────────────────────────────────────────────────────────────
// Soul (re-exported from soul-loader for convenience)
// ────────────────────────────────────────────────────────────

export type { Soul } from "../services/soul-loader";

// ────────────────────────────────────────────────────────────
// Token tracking & cost
// ────────────────────────────────────────────────────────────

/** Per-provider token usage record (for the debug dashboard). */
export interface TokenUsageRecord {
  readonly provider: string;
  readonly model: string;
  readonly tokensUsed: number;
  readonly estimatedCost: number;
  readonly timestamp: number;
  readonly success: boolean;
}

/** Estimated cost per 1K tokens (in USD). Free models = $0. */
export interface CostEstimate {
  readonly inputCostPer1K: number;
  readonly outputCostPer1K: number;
  readonly currency: string;
}

/**
 * src/services/token-tracker.ts
 * Tracks token usage and estimates cost per provider/model.
 *
 * Free models cost $0. Paid models (future) have non-zero rates.
 * Records are kept in-memory (per isolate) for the debug dashboard.
 */

import type { TokenUsageRecord, CostEstimate } from "../types/ai";
import type { Logger } from "./logger";

export interface TokenTrackerDeps {
  readonly logger: Logger;
}

/** Cost estimates per provider (free models = $0). */
const COST_ESTIMATES: Readonly<Record<string, CostEstimate>> = {
  gemini: { inputCostPer1K: 0, outputCostPer1K: 0, currency: "USD" },
  openrouter: { inputCostPer1K: 0, outputCostPer1K: 0, currency: "USD" },
};

/** Estimate token count from text length (rough: 1 token ≈ 4 chars). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TokenTracker {
  private readonly records: TokenUsageRecord[] = [];
  private static readonly MAX_RECORDS = 100;

  constructor(private readonly deps: TokenTrackerDeps) {}

  /** Record a token usage event. */
  record(
    provider: string,
    model: string,
    tokensUsed: number,
    success: boolean,
  ): TokenUsageRecord {
    const cost = this.estimateCost(provider, tokensUsed);
    const record: TokenUsageRecord = {
      provider,
      model,
      tokensUsed,
      estimatedCost: cost,
      timestamp: Date.now(),
      success,
    };

    this.records.unshift(record);
    if (this.records.length > TokenTracker.MAX_RECORDS) {
      this.records.length = TokenTracker.MAX_RECORDS;
    }

    this.deps.logger.debug("ai.success", {
      provider,
      model,
      tokensUsed,
      estimatedCost: cost,
      success,
    });

    return record;
  }

  /** Estimate cost for a token count. */
  estimateCost(provider: string, tokensUsed: number): number {
    const estimate = COST_ESTIMATES[provider];
    if (!estimate) return 0;
    // Assume 50/50 input/output split for estimation.
    return (tokensUsed / 1000) * (estimate.inputCostPer1K + estimate.outputCostPer1K) / 2;
  }

  /** Get recent records (for the debug dashboard). */
  getRecords(limit = 20): readonly TokenUsageRecord[] {
    return this.records.slice(0, limit);
  }

  /** Get aggregate stats. */
  getStats(): {
    readonly totalCalls: number;
    readonly successfulCalls: number;
    readonly failedCalls: number;
    readonly totalTokens: number;
    readonly totalCost: number;
    readonly byProvider: Readonly<Record<string, { calls: number; tokens: number; cost: number }>>;
  } {
    let totalTokens = 0;
    let totalCost = 0;
    let successfulCalls = 0;
    let failedCalls = 0;
    const byProvider: Record<string, { calls: number; tokens: number; cost: number }> = {};

    for (const record of this.records) {
      totalTokens += record.tokensUsed;
      totalCost += record.estimatedCost;
      if (record.success) successfulCalls++;
      else failedCalls++;

      if (!byProvider[record.provider]) {
        byProvider[record.provider] = { calls: 0, tokens: 0, cost: 0 };
      }
      byProvider[record.provider]!.calls++;
      byProvider[record.provider]!.tokens += record.tokensUsed;
      byProvider[record.provider]!.cost += record.estimatedCost;
    }

    return {
      totalCalls: this.records.length,
      successfulCalls,
      failedCalls,
      totalTokens,
      totalCost,
      byProvider,
    };
  }

  /** Clear all records. */
  clear(): void {
    this.records.length = 0;
  }
}

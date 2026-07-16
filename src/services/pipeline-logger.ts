/**
 * src/services/pipeline-logger.ts
 * Structured pipeline logger — records each stage of the content pipeline.
 *
 * Every pipeline execution produces a PipelineLog that captures:
 *   - Provider ID
 *   - Each stage result (normalize, validate, dedup, enrich, rank, AI, format)
 *   - Ranking score
 *   - AI provider used
 *   - Quality score
 *   - Generation time
 *   - Queue status
 *   - Errors
 *
 * The last pipeline log is stored in KV for the Manager Dashboard.
 */

import type { KVStore } from "./kv-store";

/** A single stage in the pipeline log. */
export interface PipelineStageLog {
  readonly stage: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly message: string | null;
}

/** Complete pipeline execution log. */
export interface PipelineLog {
  readonly pipelineId: string;
  readonly provider: string;
  readonly category: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly stages: PipelineStageLog[];
  readonly rankingScore: number | null;
  readonly aiProvider: string | null;
  readonly aiModel: string | null;
  readonly qualityScore: number | null;
  readonly queueDepthBefore: number | null;
  readonly queueDepthAfter: number | null;
  readonly success: boolean;
  readonly error: string | null;
}

/** Builder for PipelineLog — accumulates data during pipeline execution. */
export class PipelineLogBuilder {
  private pipelineId: string;
  private provider: string;
  private category: string;
  private startedAt: number;
  private stages: PipelineStageLog[] = [];
  private rankingScore: number | null = null;
  private aiProvider: string | null = null;
  private aiModel: string | null = null;
  private qualityScore: number | null = null;
  private queueDepthBefore: number | null = null;
  private queueDepthAfter: number | null = null;
  private success = false;
  private error: string | null = null;

  constructor(provider: string, category: string) {
    this.pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.provider = provider;
    this.category = category;
    this.startedAt = Date.now();
  }

  addStage(stage: string, ok: boolean, durationMs: number, message?: string): void {
    this.stages.push({ stage, ok, durationMs, message: message ?? null });
  }

  setRankingScore(score: number): void { this.rankingScore = score; }
  setAI(provider: string, model: string): void { this.aiProvider = provider; this.aiModel = model; }
  setQualityScore(score: number): void { this.qualityScore = score; }
  setQueueDepth(before: number, after: number): void { this.queueDepthBefore = before; this.queueDepthAfter = after; }
  setSuccess(success: boolean): void { this.success = success; }
  setError(error: string): void { this.error = error; }

  build(): PipelineLog {
    const endedAt = Date.now();
    return {
      pipelineId: this.pipelineId,
      provider: this.provider,
      category: this.category,
      startedAt: this.startedAt,
      endedAt,
      durationMs: endedAt - this.startedAt,
      stages: this.stages,
      rankingScore: this.rankingScore,
      aiProvider: this.aiProvider,
      aiModel: this.aiModel,
      qualityScore: this.qualityScore,
      queueDepthBefore: this.queueDepthBefore,
      queueDepthAfter: this.queueDepthAfter,
      success: this.success,
      error: this.error,
    };
  }
}

/** Persists pipeline logs to KV. */
export class PipelineLogger {
  private static readonly LAST_LOG_KEY = "fredy:pipeline:lastLog";
  private static readonly LOG_TTL_SECONDS = 7 * 24 * 3600;

  constructor(private readonly kv: KVStore) {}

  async save(log: PipelineLog): Promise<void> {
    try {
      await this.kv.setJson(PipelineLogger.LAST_LOG_KEY, log, PipelineLogger.LOG_TTL_SECONDS);
    } catch { /* non-fatal */ }
  }

  async load(): Promise<PipelineLog | null> {
    try {
      return await this.kv.getJson<PipelineLog>(PipelineLogger.LAST_LOG_KEY);
    } catch { return null; }
  }
}

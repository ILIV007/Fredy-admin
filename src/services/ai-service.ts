/**
 * src/services/ai-service.ts
 * AI Manager — orchestrates the full AI generation pipeline:
 *   1. Build prompt (system + soul + language + user)
 *   2. Try providers with fallback (retry within each provider)
 *   3. Parse + validate response
 *   4. Evaluate quality (6 dimensions)
 *   5. Return structured result with metadata
 *
 * See ARCHITECTURE_RULES.md §21.6 (multi-model race), §10 (logging), §9 (error handling).
 */

import type { AIProvider } from "../types/plugin";
import type {
  AICompleteRequest,
  AICompleteResponse,
  GenerateRequest,
  GenerateResult,
  GenerateAttempt,
  AIGeneratedContent,
} from "../types/ai";
import type { QualityResult } from "../types/quality";
import type { FredySettings } from "../types/config";
import type { SoulLoader } from "./soul-loader";
import type { PromptBuilder } from "./prompt-builder";
import type { ResponseParser } from "./response-parser";
import type { RetryHandler } from "./retry-handler";
import type { FallbackHandler } from "./fallback-handler";
import type { TokenTracker } from "./token-tracker";
import type { QualityEngine } from "./quality-engine";
import type { Logger } from "./logger";
import type { KVStore } from "./kv-store";

export interface AIServiceDeps {
  readonly providers: readonly AIProvider[];
  readonly preferred: "gemini" | "openrouter" | "auto";
  readonly soul: SoulLoader;
  readonly promptBuilder: PromptBuilder;
  readonly responseParser: ResponseParser;
  readonly retryHandler: RetryHandler;
  readonly fallbackHandler: FallbackHandler;
  readonly tokenTracker: TokenTracker;
  readonly qualityEngine: QualityEngine;
  readonly logger: Logger;
  readonly settings: () => Promise<FredySettings>;
  /** Optional KV store for loading recent AI content hashes (anti-repeat).
   *  When provided, the AI service loads the last N published content hashes
   *  and passes them to the quality engine so it can detect near-duplicate
   *  AI output before the content reaches the publish stage. */
  readonly kv?: KVStore;
}

export interface GenerateWithQualityResult extends GenerateResult {
  readonly quality: QualityResult | null;
}

export class AIService {
  constructor(private readonly deps: AIServiceDeps) {}

  /**
   * Generate a post from a source item. Full pipeline:
   *   prompt → fallback+retry → parse → quality.
   */
  async generate(request: GenerateRequest): Promise<GenerateWithQualityResult> {
    const startTime = Date.now();
    const settings = await this.deps.settings();
    const aiConfig = settings.ai;

    // Step 1: build the prompt.
    const prompt = await this.deps.promptBuilder.build(
      request.category,
      request.raw,
      request.language,
      request.soul,
      request.promptProfile ?? aiConfig.promptProfile,
    );

    this.deps.logger.info("ai.start", {
      category: request.category,
      source: request.source,
      language: prompt.resolvedLanguage,
      profile: request.promptProfile ?? aiConfig.promptProfile,
    });

    // Step 2: order providers (preferred first, then others).
    const orderedProviders = this.orderProviders(request);

    // Step 3: try providers with fallback.
    const fallbackResult = await this.deps.fallbackHandler.execute(
      orderedProviders,
      {
        system: prompt.system,
        user: prompt.user,
        jsonMode: true,
        maxTokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
      },
      aiConfig.timeoutMs,
    );

    const attempts: GenerateAttempt[] = fallbackResult.attempts.map((a) => ({
      provider: a.provider,
      model: a.model,
      ok: a.ok,
      latencyMs: 0, // not tracked per-attempt in fallback handler
      error: a.error,
      aborted: a.error?.toLowerCase().includes("abort") ?? false,
    }));

    if (!fallbackResult.ok || !fallbackResult.response) {
      const totalTime = Date.now() - startTime;
      this.deps.logger.error("ai.error", {
        message: "All providers failed",
        attempts: attempts.length,
        durationMs: totalTime,
        attemptDetails: attempts.map(a => ({ provider: a.provider, model: a.model, ok: a.ok, error: a.error })),
      });

      return {
        ok: false,
        content: null,
        provider: "none",
        model: "none",
        latencyMs: totalTime,
        tokensUsed: 0,
        estimatedCost: 0,
        attempts,
        quality: null,
        error: `All AI providers failed: ${attempts.map(a => `${a.provider}/${a.model}: ${a.error}`).join("; ")}`,
      };
    }

    // Step 4: parse + validate the response.
    let content: AIGeneratedContent;
    try {
      content = this.deps.responseParser.parse(
        fallbackResult.response.text,
        fallbackResult.response.provider,
        fallbackResult.response.model,
        prompt.resolvedLanguage,
      );
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error("ai.error", {
        message: "Response parse failed",
        error: message,
        provider: fallbackResult.response.provider,
        model: fallbackResult.response.model,
      });

      return {
        ok: false,
        content: null,
        provider: fallbackResult.response.provider,
        model: fallbackResult.response.model,
        latencyMs: totalTime,
        tokensUsed: fallbackResult.response.tokensUsed ?? 0,
        estimatedCost: 0,
        attempts,
        quality: null,
        error: message,
      };
    }

    // Step 5: track token usage.
    const tokensUsed = fallbackResult.response.tokensUsed ?? estimateTokens(content.text);
    this.deps.tokenTracker.record(
      fallbackResult.response.provider,
      fallbackResult.response.model,
      tokensUsed,
      true,
    );

    // Step 6: evaluate quality.
    // Load recent AI content hashes from KV (anti-repeat mechanism).
    // This prevents the AI from generating near-duplicate content on
    // consecutive ticks. The quality engine compares the new content's
    // hash against this list.
    let recentHashes: string[] = [];
    if (this.deps.kv) {
      try {
        recentHashes = await this.deps.kv.getJson<string[]>("fredy:ai:recent-hashes") ?? [];
      } catch {
        recentHashes = [];
      }
    }

    const quality = await this.deps.qualityEngine.evaluate({
      content,
      sourceItem: request.raw,
      category: request.category,
      options: {
        minScore: aiConfig.qualityThreshold,
        rejectDuplicates: settings.quality.duplicateDetection,
        duplicateTtlHours: settings.quality.duplicateTtlHours,
        recentHashes,
        requestedLanguage: prompt.resolvedLanguage,
      },
    });

    // If quality passed, record the new hash in the recent-hashes list
    // (keep last 50).
    if (quality.passed && this.deps.kv) {
      try {
        const newHash = await this.computeContentHash(content.text);
        const updated = [...recentHashes, newHash].slice(-50);
        await this.deps.kv.setJson("fredy:ai:recent-hashes", updated, 7 * 24 * 3600);
      } catch {
        // non-fatal — anti-repeat is best-effort
      }
    }

    const totalTime = Date.now() - startTime;
    const estimatedCost = this.deps.tokenTracker.estimateCost(
      fallbackResult.response.provider,
      tokensUsed,
    );

    this.deps.logger.info("ai.success", {
      provider: fallbackResult.response.provider,
      model: fallbackResult.response.model,
      tokensUsed,
      estimatedCost,
      qualityScore: quality.overallScore,
      qualityPassed: quality.passed,
      durationMs: totalTime,
    });

    return {
      ok: quality.passed,
      content,
      provider: fallbackResult.response.provider,
      model: fallbackResult.response.model,
      latencyMs: totalTime,
      tokensUsed,
      estimatedCost,
      attempts,
      quality,
    };
  }

  /** Order providers: preferred first, then others by priority. */
  private orderProviders(_request: GenerateRequest): readonly AIProvider[] {
    void _request;
    const configured = this.deps.providers; // already filtered to configured in container
    if (this.deps.preferred === "auto") return configured;

    const preferred = configured.filter((p) => p.id === this.deps.preferred);
    const others = configured.filter((p) => p.id !== this.deps.preferred);
    return [...preferred, ...others];
  }

  /** Compute a simple hash of AI-generated text for anti-repeat detection.
   *  Uses a fast non-crypto hash (djb2) — collisions are acceptable here
   *  since this is a soft quality signal, not a dedup gate. */
  private async computeContentHash(text: string): Promise<string> {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500);
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
      hash = hash & hash;
    }
    return `ai-${Math.abs(hash).toString(36)}`;
  }

  // ────────────────────────────────────────────────────────────
  // Backward-compat: low-level complete() for callers that don't need the full pipeline.
  // ────────────────────────────────────────────────────────────

  async complete(request: AICompleteRequest): Promise<AICompleteResponse> {
    const settings = await this.deps.settings();
    const result = await this.deps.fallbackHandler.execute(
      this.deps.providers,
      request,
      settings.ai.timeoutMs,
    );
    if (!result.ok || !result.response) {
      throw new Error("All AI providers failed");
    }
    return result.response;
  }

  /** Get token tracker stats (for the debug dashboard). */
  getTokenStats() {
    return this.deps.tokenTracker.getStats();
  }

  /** Get recent token records (for the debug dashboard). */
  getTokenRecords(limit = 20) {
    return this.deps.tokenTracker.getRecords(limit);
  }
}

/** Estimate token count from text length (rough: 1 token ≈ 4 chars). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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
import type { FallbackHandler } from "./fallback-handler";
import type { TokenTracker } from "./token-tracker";
import type { QualityEngine } from "./quality-engine";
import type { Logger } from "./logger";

export interface AIServiceDeps {
  readonly providers: readonly AIProvider[];
  readonly preferred: "gemini" | "openrouter" | "auto";
  readonly soul: SoulLoader;
  readonly promptBuilder: PromptBuilder;
  readonly responseParser: ResponseParser;
  readonly fallbackHandler: FallbackHandler;
  readonly tokenTracker: TokenTracker;
  readonly qualityEngine: QualityEngine;
  readonly logger: Logger;
  readonly settings: () => Promise<FredySettings>;
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
        error: "All AI providers failed",
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
    const quality = await this.deps.qualityEngine.evaluate({
      content,
      sourceItem: request.raw,
      category: request.category,
      options: {
        minScore: aiConfig.qualityThreshold,
        rejectDuplicates: settings.quality.duplicateDetection,
        duplicateTtlHours: settings.quality.duplicateTtlHours,
        recentHashes: [], // TODO: load from KV in Phase 8
        requestedLanguage: prompt.resolvedLanguage,
      },
    });

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
  private orderProviders(request: GenerateRequest): readonly AIProvider[] {
    const configured = this.deps.providers; // already filtered to configured in container
    if (this.deps.preferred === "auto") return configured;

    const preferred = configured.filter((p) => p.id === this.deps.preferred);
    const others = configured.filter((p) => p.id !== this.deps.preferred);
    return [...preferred, ...others];
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

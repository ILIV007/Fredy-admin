/**
 * src/services/fallback-handler.ts
 * Try providers in order, falling back to the next on failure.
 *
 * Used by AIService to try the primary provider first, then fall back to others.
 * Distinct from RetryHandler: retry = same provider multiple times;
 * fallback = different providers in sequence.
 */

import type { Logger } from "./logger";
import type { AIProvider } from "../types/plugin";
import type { AICompleteRequest, AICompleteResponse } from "../types/ai";
import { AIProviderError } from "../core/ai/errors";

export interface FallbackHandlerDeps {
  readonly logger: Logger;
}

export interface FallbackResult {
  readonly ok: boolean;
  readonly response: AICompleteResponse | null;
  readonly providerUsed: string | null;
  readonly modelUsed: string | null;
  readonly attempts: ReadonlyArray<{
    readonly provider: string;
    readonly model: string;
    readonly ok: boolean;
    readonly error?: string;
  }>;
}

export class FallbackHandler {
  constructor(private readonly deps: FallbackHandlerDeps) {}

  /**
   * Try each provider in order. Returns the first successful response.
   * If all fail, returns { ok: false } with all attempts recorded.
   */
  async execute(
    providers: readonly AIProvider[],
    request: AICompleteRequest,
    timeoutMs: number,
  ): Promise<FallbackResult> {
    const attempts: Array<{ provider: string; model: string; ok: boolean; error?: string }> = [];

    for (const provider of providers) {
      // Try each model the provider offers.
      for (const model of provider.models) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await provider.complete(
            { ...request, model },
            controller.signal,
          );
          clearTimeout(timeout);

          attempts.push({ provider: provider.id, model, ok: true });
          return {
            ok: true,
            response,
            providerUsed: provider.id,
            modelUsed: model,
            attempts,
          };
        } catch (error) {
          clearTimeout(timeout);
          const message = error instanceof Error ? error.message : String(error);
          attempts.push({ provider: provider.id, model, ok: false, error: message });

          this.deps.logger.warn("ai.error", {
            providerId: provider.id,
            model,
            error: message,
            message: "Falling back to next model/provider",
          });
        }
      }
    }

    return {
      ok: false,
      response: null,
      providerUsed: null,
      modelUsed: null,
      attempts,
    };
  }
}

/** Re-export AIProviderError for callers. */
export { AIProviderError };

/**
 * src/services/response-parser.ts
 * Parses and validates the AI's raw text response.
 *
 * Steps:
 *   1. Strip markdown code fences (if present).
 *   2. Detect refusal (safety filter, policy).
 *   3. Parse as JSON.
 *   4. Validate against the expected schema.
 *   5. Return the typed AIGeneratedContent.
 *
 * See src/core/ai/response-schema.ts for the validation logic.
 */

import {
  AIEmptyResponseError,
  AIRefusalError,
  AIResponseParseError,
  AIResponseValidationError,
} from "../core/ai/errors";
import {
  detectRefusal,
  stripCodeFences,
  validateAIResponse,
} from "../core/ai/response-schema";
import type { AIGeneratedContent } from "../types/ai";

export interface ResponseParserDeps {
  // No deps — this is a pure service.
}

export class ResponseParser {
  constructor(_deps: ResponseParserDeps = {}) {
    void _deps;
  }

  /**
   * Parse the AI's raw text response into a validated AIGeneratedContent.
   * Throws typed errors on failure.
   */
  parse(
    rawText: string,
    provider: string,
    model: string,
    expectedLanguage: string,
  ): AIGeneratedContent {
    // Step 1: check for empty response.
    if (!rawText || rawText.trim().length === 0) {
      throw new AIEmptyResponseError(provider, model);
    }

    // Step 2: detect refusal.
    const refusal = detectRefusal(rawText);
    if (refusal) {
      throw new AIRefusalError(provider, model, refusal);
    }

    // Step 3: strip code fences.
    const cleaned = stripCodeFences(rawText);

    // Step 4: parse as JSON.
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AIResponseParseError(provider, model, rawText, `JSON parse failed: ${message}`);
    }

    // Step 5: validate against schema.
    const result = validateAIResponse(parsed);
    if (!result.ok) {
      throw new AIResponseValidationError(
        provider,
        model,
        `Schema validation failed: ${result.errors.join("; ")}`,
        result.errors,
      );
    }

    // Step 6: verify language matches (warn but don't fail — the quality engine will penalize).
    if (expectedLanguage && result.data.generatedLanguage !== expectedLanguage) {
      // Log a warning but don't throw — the quality engine will catch this.
      console.warn(
        `[response-parser] language mismatch: expected ${expectedLanguage}, got ${result.data.generatedLanguage}`,
      );
    }

    return result.data;
  }
}

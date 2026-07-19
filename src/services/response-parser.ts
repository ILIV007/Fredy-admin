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
    // v11.4.0: Added JSON repair attempts before giving up.
    // Gemini sometimes returns JSON with trailing commas, unescaped quotes,
    // or truncated content. We try to repair common issues before failing.
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      // v11.4.0: Try to repair common JSON issues.
      const repaired = repairJson(cleaned);
      if (repaired && repaired !== cleaned) {
        try {
          parsed = JSON.parse(repaired);
        } catch {
          const message = error instanceof Error ? error.message : String(error);
          throw new AIResponseParseError(provider, model, rawText, `JSON parse failed: ${message}`);
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        throw new AIResponseParseError(provider, model, rawText, `JSON parse failed: ${message}`);
      }
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

/**
 * v11.4.0: Attempt to repair common JSON issues returned by AI models.
 *
 * Common issues:
 * - Trailing commas: {"a": 1,} → {"a": 1}
 * - Unescaped newlines in strings: "text\nmore" → "text\\nmore"
 * - Truncated JSON: missing closing brace → add it
 * - Extra text after JSON: {...}garbage → {...}
 * - Wrapped in text: "Here is the JSON: {...}" → {...}
 *
 * Returns the repaired JSON string, or null if repair failed.
 */
function repairJson(input: string): string | null {
  let s = input.trim();

  // 1. Extract JSON object/array from surrounding text.
  // Find the first { or [ and the last } or ].
  const firstBrace = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  let start = -1;
  let end = -1;
  let closeChar = "";

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    closeChar = "}";
  } else if (firstBracket !== -1) {
    start = firstBracket;
    closeChar = "]";
  } else {
    return null;
  }

  end = s.lastIndexOf(closeChar);
  if (end <= start) return null;

  s = s.slice(start, end + 1);

  // 2. Remove trailing commas before } or ].
  s = s.replace(/,\s*([}\]])/g, "$1");

  // 3. Escape unescaped newlines/tabs inside string values.
  // This is tricky — we only want to escape inside strings, not in the JSON structure.
  // Simple approach: replace literal newlines that are between quotes.
  s = s.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
    return match.replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
  });

  // 4. If the JSON is truncated (unbalanced braces), try to close it.
  const openCount = (s.match(/{/g) ?? []).length;
  const closeCount = (s.match(/}/g) ?? []).length;
  if (openCount > closeCount) {
    s += "}".repeat(openCount - closeCount);
  }

  const openBracketCount = (s.match(/\[/g) ?? []).length;
  const closeBracketCount = (s.match(/\]/g) ?? []).length;
  if (openBracketCount > closeBracketCount) {
    s += "]".repeat(openBracketCount - closeBracketCount);
  }

  return s;
}

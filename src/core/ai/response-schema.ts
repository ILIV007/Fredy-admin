/**
 * src/core/ai/response-schema.ts
 * Validation for the AI's JSON response.
 *
 * The AI is asked to return a JSON object with a specific shape.
 * This module validates that shape and extracts the fields.
 * See ARCHITECTURE_RULES.md §8.2 (schema validation).
 */

import type { AIGeneratedContent } from "../../types/ai";

/** Required fields in the AI response. */
const REQUIRED_FIELDS = ["text", "aiConfidence", "generatedLanguage"] as const;

/** Maximum allowed text length (Telegram limit). */
const MAX_TEXT_LENGTH = 4096;

/** Minimum allowed text length (reject empty / near-empty). */
const MIN_TEXT_LENGTH = 20;

/**
 * Validate a parsed AI response object.
 * Returns { ok: true, data } or { ok: false, errors }.
 */
export function validateAIResponse(
  input: unknown,
):
  | { readonly ok: true; readonly data: AIGeneratedContent }
  | { readonly ok: false; readonly errors: readonly string[] } {
  if (input === null || input === undefined || typeof input !== "object") {
    return { ok: false, errors: ["Response is not an object"] };
  }

  const obj = input as Record<string, unknown>;
  const errors: string[] = [];

  // Check required fields.
  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Validate text.
  const text = obj["text"];
  if (typeof text !== "string") {
    errors.push(`"text" must be a string, got ${typeof text}`);
  } else {
    if (text.trim().length < MIN_TEXT_LENGTH) {
      errors.push(`"text" is too short (${text.trim().length} chars, min ${MIN_TEXT_LENGTH})`);
    }
    if (text.length > MAX_TEXT_LENGTH) {
      errors.push(`"text" is too long (${text.length} chars, max ${MAX_TEXT_LENGTH})`);
    }
  }

  // Validate aiConfidence.
  const aiConfidence = obj["aiConfidence"];
  if (typeof aiConfidence !== "number" || aiConfidence < 0 || aiConfidence > 100) {
    errors.push(`"aiConfidence" must be a number 0-100, got ${JSON.stringify(aiConfidence)}`);
  }

  // Validate generatedLanguage.
  const generatedLanguage = obj["generatedLanguage"];
  if (typeof generatedLanguage !== "string" || !["en", "fa"].includes(generatedLanguage)) {
    errors.push(`"generatedLanguage" must be "en" or "fa", got ${JSON.stringify(generatedLanguage)}`);
  }

  // Validate optional fields.
  if (obj["headline"] !== undefined && typeof obj["headline"] !== "string") {
    errors.push(`"headline" must be a string if present`);
  }
  if (obj["keyPoints"] !== undefined) {
    if (!Array.isArray(obj["keyPoints"])) {
      errors.push(`"keyPoints" must be an array if present`);
    } else {
      for (let i = 0; i < obj["keyPoints"].length; i++) {
        if (typeof obj["keyPoints"][i] !== "string") {
          errors.push(`"keyPoints[${i}]" must be a string`);
        }
      }
    }
  }
  if (obj["notes"] !== undefined && typeof obj["notes"] !== "string") {
    errors.push(`"notes" must be a string if present`);
  }

  if (errors.length > 0) return { ok: false, errors };

  // Build the typed object.
  const data: AIGeneratedContent = {
    text: String(text),
    aiConfidence: Math.round(Number(aiConfidence)),
    generatedLanguage: String(generatedLanguage),
    headline: obj["headline"] !== undefined ? String(obj["headline"]) : undefined,
    keyPoints: Array.isArray(obj["keyPoints"]) ? (obj["keyPoints"] as string[]) : undefined,
    notes: obj["notes"] !== undefined ? String(obj["notes"]) : undefined,
  };

  return { ok: true, data };
}

/**
 * Detect AI refusal. Some models return text like "I cannot fulfill this request"
 * instead of the JSON object. Catch that here.
 */
export function detectRefusal(rawText: string): string | null {
  const lower = rawText.toLowerCase();
  const refusalPatterns = [
    "i cannot fulfill",
    "i can't fulfill",
    "i am unable to",
    "i'm unable to",
    "as an ai language model",
    "i cannot generate",
    "i can't generate",
    "i cannot assist with that",
  ];
  for (const pattern of refusalPatterns) {
    if (lower.includes(pattern)) return pattern;
  }
  return null;
}

/**
 * Strip markdown code fences if the AI wrapped the JSON in ```json ... ```.
 * Some models do this despite instructions not to.
 */
export function stripCodeFences(rawText: string): string {
  const trimmed = rawText.trim();
  // Match ```json\n...\n``` or ```\n...\n```
  const fenceMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed);
  if (fenceMatch) return fenceMatch[1] ?? trimmed;
  return trimmed;
}

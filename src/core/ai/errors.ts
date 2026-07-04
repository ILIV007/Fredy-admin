/**
 * src/core/ai/errors.ts
 * AI-specific error hierarchy. See ARCHITECTURE_RULES.md §9.3.
 */

import { AppError } from "../errors";

/** Base class for all AI errors. */
export class AIError extends AppError {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly model?: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { provider, model, ...context });
  }
}

/** Thrown when an AI provider call fails (network, HTTP error, parse error). */
export class AIProviderError extends AIError {
  constructor(
    provider: string,
    model: string,
    message: string,
    public readonly statusCode?: number,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, provider, model, { statusCode, ...context });
  }
}

/** Thrown when all AI providers fail. */
export class AllProvidersFailedError extends AIError {
  constructor(
    public readonly failures: readonly AIProviderError[],
  ) {
    const summary = failures.map((f) => `${f.provider}/${f.model}: ${f.message}`).join("; ");
    super(`All AI providers failed: ${summary}`, undefined, undefined, {
      count: failures.length,
    });
  }
}

/** Thrown when the AI response cannot be parsed as valid JSON. */
export class AIResponseParseError extends AIError {
  constructor(
    provider: string,
    model: string,
    public readonly rawResponse: string,
    message: string,
  ) {
    super(message, provider, model, { rawResponseLength: rawResponse.length });
  }
}

/** Thrown when the AI response is valid JSON but fails schema validation. */
export class AIResponseValidationError extends AIError {
  constructor(
    provider: string,
    model: string,
    message: string,
    public readonly validationErrors: readonly string[],
  ) {
    super(message, provider, model, { validationErrors });
  }
}

/** Thrown when the AI response is empty or only whitespace. */
export class AIEmptyResponseError extends AIError {
  constructor(provider: string, model: string) {
    super("AI returned empty response", provider, model);
  }
}

/** Thrown when the AI request times out. */
export class AITimeoutError extends AIError {
  constructor(
    provider: string,
    model: string,
    public readonly timeoutMs: number,
  ) {
    super(`AI request timed out after ${timeoutMs}ms`, provider, model, { timeoutMs });
  }
}

/** Thrown when the AI refused to generate (safety filter, policy). */
export class AIRefusalError extends AIError {
  constructor(
    provider: string,
    model: string,
    public readonly refusalReason: string,
  ) {
    super(`AI refused to generate: ${refusalReason}`, provider, model, { refusalReason });
  }
}

/** Thrown when the AI generated in the wrong language. */
export class AILanguageMismatchError extends AIError {
  constructor(
    provider: string,
    model: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Language mismatch: expected "${expected}", got "${actual}"`, provider, model, {
      expected,
      actual,
    });
  }
}

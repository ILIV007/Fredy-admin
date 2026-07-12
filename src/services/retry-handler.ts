/**
 * src/services/retry-handler.ts
 * Retry with exponential backoff.
 *
 * Used by AIService to retry a failed provider call before falling back.
 * Retries on network errors and 5xx; does NOT retry on 4xx (except 429).
 */

import type { Logger } from "./logger";

export interface RetryHandlerDeps {
  readonly logger: Logger;
}

export interface RetryOptions {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  /** Whether to retry on this error. Returns true for retryable, false for permanent. */
  readonly isRetryable?: (error: unknown) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

export interface RetryResult<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly error: unknown;
  readonly attempts: number;
}

export class RetryHandler {
  constructor(private readonly deps: RetryHandlerDeps) {}

  /** Execute a function with retry. */
  async execute<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
  ): Promise<RetryResult<T>> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    const isRetryable = opts.isRetryable ?? defaultIsRetryable;

    let lastError: unknown = null;
    let attempt = 0;

    while (attempt <= opts.maxRetries) {
      try {
        const value = await fn();
        return { ok: true, value, error: null, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        attempt++;

        if (attempt > opts.maxRetries || !isRetryable(error)) {
          return { ok: false, value: null, error, attempts: attempt };
        }

        const delay = Math.min(
          opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs,
        );

        this.deps.logger.warn("ai.error", {
          message: `Retry ${attempt}/${opts.maxRetries} after ${delay}ms`,
          error: error instanceof Error ? error.message : String(error),
        });

        await sleep(delay);
      }
    }

    return { ok: false, value: null, error: lastError, attempts: attempt };
  }
}

/** Default retryable check: retry on network errors and 5xx/429, don't retry on 4xx. */
function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network errors.
    if (message.includes("network") || message.includes("timeout") || message.includes("abort")) {
      return true;
    }
    // HTTP status codes embedded in the message.
    if (message.includes("429")) return true; // rate limit
    if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

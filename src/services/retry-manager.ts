/**
 * src/services/retry-manager.ts
 * Retry manager for Telegram publish failures.
 *
 * If Telegram fails: retry (up to maxRetries).
 * If retry fails: log error, continue queue (move to DLQ).
 *
 * See Prompt 9 spec.
 */

import type { Logger } from "./logger";

export interface RetryManagerDeps {
  readonly logger: Logger;
}

export interface RetryOptions {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

export interface RetryResult<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly error: string | null;
  readonly attempts: number;
}

export class RetryManager {
  constructor(private readonly deps: RetryManagerDeps) {}

  /** Execute a function with retry. Returns the result or the last error. */
  async execute<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
  ): Promise<RetryResult<T>> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: string | null = null;
    let attempt = 0;

    while (attempt <= opts.maxRetries) {
      try {
        const value = await fn();
        return { ok: true, value, error: null, attempts: attempt + 1 };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        attempt++;

        if (attempt > opts.maxRetries) {
          this.deps.logger.error("telegram.error", {
            message: `All ${opts.maxRetries} retries exhausted`,
            error: lastError,
            attempts: attempt,
          });
          return { ok: false, value: null, error: lastError, attempts: attempt };
        }

        const delay = Math.min(
          opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs,
        );

        this.deps.logger.warn("telegram.error", {
          message: `Retry ${attempt}/${opts.maxRetries} after ${delay}ms`,
          error: lastError,
        });

        await this.sleep(delay);
      }
    }

    return { ok: false, value: null, error: lastError, attempts: attempt };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Re-export for testing. */
export { DEFAULT_RETRY_OPTIONS };

/**
 * src/core/errors.ts
 * Typed error hierarchy. Every error carries context for the debug dashboard.
 * See ARCHITECTURE_RULES.md §9.3.
 */

/** Base class for all Fredy errors. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
    };
  }
}

/** A content source fetch failed. */
export class SourceFetchError extends AppError {
  constructor(
    source: string,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { source, ...context });
  }
}

/** An AI provider call failed. */
export class AIProviderError extends AppError {
  constructor(
    provider: string,
    model: string,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { provider, model, ...context });
  }
}

/** All AI providers failed. */
export class AllProvidersFailedError extends AppError {
  constructor(
    public readonly failures: readonly AIProviderError[],
  ) {
    const summary = failures.map((f) => f.message).join("; ");
    super(`All AI providers failed: ${summary}`, {
      count: failures.length,
      providers: failures.map((f) => f.context["provider"]),
    });
  }
}

/** A quality check rejected a post. */
export class QualityRejectionError extends AppError {
  constructor(
    reason: string,
    public readonly score: number,
    public readonly failedChecks: readonly string[],
  ) {
    super(reason, { score, failedChecks });
  }
}

/** A Telegram API call failed. */
export class TelegramApiError extends AppError {
  constructor(
    method: string,
    public readonly errorCode: number | undefined,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { method, errorCode, ...context });
  }
}

/** A KV operation failed. */
export class KVError extends AppError {
  constructor(
    operation: string,
    key: string,
    message: string,
  ) {
    super(message, { operation, key });
  }
}

/** A scheduler operation failed. */
export class SchedulerError extends AppError {
  constructor(
    operation: string,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { operation, ...context });
  }
}

/** A configuration update was rejected (schema validation). */
export class ConfigValidationError extends AppError {
  constructor(
    message: string,
    public readonly errors: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(message, { errors });
  }
}

/** Thrown by skeleton methods that have not been implemented yet. */
export class NotImplementedError extends AppError {
  constructor(
    public readonly methodName: string,
    public readonly className: string,
  ) {
    super(`${className}.${methodName} not implemented`, { methodName, className });
  }
}

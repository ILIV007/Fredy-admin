/**
 * src/core/plugin/errors.ts
 * Plugin-specific error hierarchy. Every plugin failure uses one of these.
 * See ARCHITECTURE_RULES.md §9.3 (Typed errors).
 */

import { AppError } from "../errors";

/** Base class for all plugin errors. */
export class PluginError extends AppError {
  constructor(
    message: string,
    public readonly pluginId: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { pluginId, ...context });
  }
}

/** Thrown when a plugin is not registered with the PluginManager. */
export class PluginNotRegisteredError extends PluginError {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is not registered`, pluginId);
  }
}

/** Thrown when a disabled plugin is called. Disabled plugins must never execute. */
export class PluginDisabledError extends PluginError {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is disabled — refusing to execute`, pluginId);
  }
}

/** Thrown when a plugin's fetch() fails (network, API, parse error). */
export class PluginFetchError extends PluginError {
  constructor(
    pluginId: string,
    message: string,
    public readonly statusCode?: number,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, pluginId, { statusCode, ...context });
  }
}

/** Thrown when a plugin returns data that fails validation. */
export class PluginValidationError extends PluginError {
  constructor(
    pluginId: string,
    message: string,
    public readonly itemPreview?: string,
  ) {
    super(message, pluginId, { itemPreview });
  }
}

/** Thrown when a plugin's fetch() exceeds its timeout. */
export class PluginTimeoutError extends PluginError {
  constructor(
    pluginId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Plugin "${pluginId}" timed out after ${timeoutMs}ms`, pluginId, { timeoutMs });
  }
}

/** Thrown when a plugin's interface does not conform to the Plugin contract. */
export class PluginInterfaceError extends PluginError {
  constructor(
    pluginId: string,
    public readonly missingMethods: readonly string[],
  ) {
    super(
      `Plugin "${pluginId}" does not implement the Plugin interface (missing: ${missingMethods.join(", ")})`,
      pluginId,
      { missingMethods },
    );
  }
}

/** Thrown when a plugin with the same ID is registered twice. */
export class PluginAlreadyRegisteredError extends PluginError {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is already registered`, pluginId);
  }
}

/** Thrown when a plugin's rate limit is exceeded. */
export class PluginRateLimitError extends PluginError {
  constructor(
    pluginId: string,
    public readonly resetAt: number,
  ) {
    super(`Plugin "${pluginId}" rate limit exceeded (resets at ${new Date(resetAt).toISOString()})`, pluginId, { resetAt });
  }
}

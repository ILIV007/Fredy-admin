/**
 * src/services/plugin-logger.ts
 * Plugin-specific logger wrapper. Adds plugin context to every log entry.
 *
 * Each plugin receives a PluginLogger bound to its ID. This way, every log
 * the plugin produces automatically includes the pluginId field, without
 * the plugin having to pass it manually every time.
 */

import type { Logger } from "./logger";
import type { DebugEventName } from "../types/debug";

export interface PluginLoggerDeps {
  readonly logger: Logger;
  readonly pluginId: string;
}

export class PluginLogger {
  constructor(private readonly deps: PluginLoggerDeps) {}

  error(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    return this.deps.logger.error(event, { pluginId: this.deps.pluginId, ...context });
  }

  warn(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    return this.deps.logger.warn(event, { pluginId: this.deps.pluginId, ...context });
  }

  info(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    return this.deps.logger.info(event, { pluginId: this.deps.pluginId, ...context });
  }

  debug(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    return this.deps.logger.debug(event, { pluginId: this.deps.pluginId, ...context });
  }
}

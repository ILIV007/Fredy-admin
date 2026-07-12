/**
 * src/core/config/sections/logging.ts
 * Logging configuration. Separate from debug.ts: logging is about WHERE logs go,
 * debug is about WHAT gets captured.
 */

import { z } from "zod";

export const loggingSchema = z.object({
  _version: z.literal(1),
  kvWrites: z.boolean(),
  consoleLevel: z.enum(["error", "warn", "info", "debug"]),
  kvLevel: z.enum(["error", "warn", "info", "debug"]),
  includeStackTrace: z.boolean(),
  maxContextLength: z.number().int().min(100).max(10000).default(2000),
});

export type LoggingConfig = z.infer<typeof loggingSchema>;

export const loggingDefaults: LoggingConfig = {
  _version: 1,
  kvWrites: true,
  consoleLevel: "info",
  kvLevel: "info",
  includeStackTrace: true,
  maxContextLength: 2000,
};

export const loggingSection = {
  key: "logging",
  version: 1,
  schema: loggingSchema,
  defaults: loggingDefaults,
  description:
    "KV log writes, console level, KV level, stack trace inclusion, and max context length.",
};

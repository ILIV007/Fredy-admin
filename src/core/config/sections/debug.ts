/**
 * src/core/config/sections/debug.ts
 * Debug system configuration. See ARCHITECTURE_RULES.md §11.
 */

import { z } from "zod";

export const debugSchema = z.object({
  _version: z.literal(1),
  enabled: z.boolean(),
  logLevel: z.enum(["error", "warn", "info", "debug"]),
  simulationMode: z.boolean(),
  verboseOutput: z.boolean(),
  ringBufferCapacity: z.number().int().min(10).max(500).default(30),
});

export type DebugConfig = z.infer<typeof debugSchema>;

export const debugDefaults: DebugConfig = {
  _version: 1,
  enabled: false,
  logLevel: "info",
  simulationMode: false,
  verboseOutput: false,
  ringBufferCapacity: 30,
};

export const debugSection = {
  key: "debug",
  version: 1,
  schema: debugSchema,
  defaults: debugDefaults,
  description:
    "Debug mode toggle, log level, simulation mode, verbose output, and ring buffer size.",
};

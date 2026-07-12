/**
 * src/core/config/sections/plugins.ts
 * Plugin manager configuration. Per-plugin overrides plus global defaults.
 */

import { z } from "zod";

export const pluginOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  retryCount: z.number().int().min(0).max(5).optional(),
  dailyLimit: z.number().int().min(0).max(10000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const pluginsSchema = z.object({
  _version: z.literal(1),
  defaultTimeoutMs: z.number().int().min(1000).max(60000),
  defaultRetryCount: z.number().int().min(0).max(5),
  defaultDailyLimit: z.number().int().min(0).max(10000),
  perPlugin: z.record(z.string(), pluginOverrideSchema),
});

export type PluginOverride = z.infer<typeof pluginOverrideSchema>;
export type PluginsConfig = z.infer<typeof pluginsSchema>;

export const pluginsDefaults: PluginsConfig = {
  _version: 1,
  defaultTimeoutMs: 15000,
  defaultRetryCount: 1,
  defaultDailyLimit: 100,
  perPlugin: {
    github: { enabled: true, priority: 1, dailyLimit: 50 },
    news: { enabled: true, priority: 2, dailyLimit: 30 },
    nasa: { enabled: true, priority: 3, dailyLimit: 1 },
    joke: { enabled: true, priority: 4, dailyLimit: 50 },
  },
};

export const pluginsSection = {
  key: "plugins",
  version: 1,
  schema: pluginsSchema,
  defaults: pluginsDefaults,
  description:
    "Plugin manager defaults (timeout, retry, daily limit) and per-plugin overrides with metadata.",
};

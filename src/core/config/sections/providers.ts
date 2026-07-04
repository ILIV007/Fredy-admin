/**
 * src/core/config/sections/providers.ts
 * Per-provider configuration for AI providers (Gemini, OpenRouter).
 * Each provider has its own model list, timeout, retry, and daily limit.
 */

import { z } from "zod";

export const providerConfigSchema = z.object({
  enabled: z.boolean(),
  models: z.array(z.string().min(1)).min(1),
  timeoutMs: z.number().int().min(5000).max(60000),
  retryCount: z.number().int().min(0).max(5),
  dailyLimit: z.number().int().min(0).max(10000),
  priority: z.number().int().min(1).max(10),
});

export const providersSchema = z.object({
  _version: z.literal(1),
  gemini: providerConfigSchema,
  openrouter: providerConfigSchema,
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProvidersConfig = z.infer<typeof providersSchema>;

export const providersDefaults: ProvidersConfig = {
  _version: 1,
  gemini: {
    enabled: true,
    models: [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    timeoutMs: 15000,
    retryCount: 1,
    dailyLimit: 1500,
    priority: 1,
  },
  openrouter: {
    enabled: true,
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "google/gemma-4-31b-it:free",
    ],
    timeoutMs: 15000,
    retryCount: 1,
    dailyLimit: 200,
    priority: 2,
  },
};

export const providersSection = {
  key: "providers",
  version: 1,
  schema: providersSchema,
  defaults: providersDefaults,
  description:
    "Per-provider enable, model list, timeout, retry, daily limit, and priority.",
};

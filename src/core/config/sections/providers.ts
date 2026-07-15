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
    // Order = fallback priority (first = primary, last = last resort).
    // Only stable models are used — preview models removed per user request.
    // 3.x stable models ranked per the 2026 free-tier ranking
    // (3.5-flash > 3.1-flash-lite > 3-flash), all above the legacy 2.5 line.
    // Gemini 2.5 series deliberately placed AFTER all 3.x models.
    models: [
      // ── 3.x stable (ranked per AI Studio 2026 free-tier guide) ──
      "gemini-3.5-flash",                // #1 best overall — frontier + 1M ctx
      "gemini-3.1-flash-lite",           // #2 fastest stable 3.x lite
      "gemini-3-flash",                  // #2 alt — stable 3.x flash
      // ── 2.5 legacy (placed AFTER all 3.x, per user request) ──
      "gemini-2.5-flash",                // legacy reliable
      "gemini-2.5-flash-lite",           // legacy lite
      "gemini-2.0-flash",                // last resort
    ],
    timeoutMs: 15000,
    retryCount: 0,
    dailyLimit: 1500,
    priority: 1,
  },
  openrouter: {
    enabled: true,
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-120b:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
    timeoutMs: 15000,
    retryCount: 0,
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

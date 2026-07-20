/**
 * src/core/config/sections/ai.ts
 * AI generation configuration. Provider-specific settings are in providers.ts.
 */

import { z } from "zod";

export const aiSchema = z.object({
  _version: z.literal(1),
  primaryProvider: z.enum(["gemini", "openrouter"]),
  fallbackProvider: z.enum(["gemini", "openrouter", "none"]),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(256).max(8192),
  retryCount: z.number().int().min(0).max(5),
  promptProfile: z.enum(["default", "concise", "detailed"]),
  qualityThreshold: z.number().min(0).max(100),
  timeoutMs: z.number().int().min(5000).max(60000).default(15000),
});

export type AIConfig = z.infer<typeof aiSchema>;

export const aiDefaults: AIConfig = {
  _version: 1,
  primaryProvider: "gemini",
  fallbackProvider: "openrouter",
  temperature: 0.7,
  maxTokens: 3096,
  retryCount: 0,
  promptProfile: "default",
  qualityThreshold: 60,
  timeoutMs: 15000,
};

export const aiSection = {
  key: "ai",
  version: 1,
  schema: aiSchema,
  defaults: aiDefaults,
  description:
    "AI provider selection, temperature, max tokens, retry count, prompt profile, quality threshold, and timeout.",
  /**
   * v11.6.3: Migration — if maxTokens is < 3096, bump it to 3096.
   * This fixes the "AI truncates posts" bug for existing deployments where
   * the old maxTokens (2000/2500) was persisted in KV.
   */
  migrate(_from: number, input: unknown): unknown {
    if (typeof input === "object" && input !== null) {
      const obj = input as Record<string, unknown>;
      const currentMaxTokens = obj["maxTokens"];
      if (typeof currentMaxTokens === "number" && currentMaxTokens < 3096) {
        obj["maxTokens"] = 3096;
      }
    }
    return input;
  },
};

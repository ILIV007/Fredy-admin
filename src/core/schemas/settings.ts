/**
 * src/core/schemas/settings.ts
 * Zod schema for FredySettings. Validates on every write.
 * See ARCHITECTURE_RULES.md §8.2 (schema validation prevents typo silent failures).
 *
 * NOTE: This file imports zod. The schema is intentionally separate from the
 * TypeScript type (src/types/config.ts) so the two can evolve independently.
 * The type is the source of truth for shape; the schema is the source of truth
 * for runtime validation.
 */

import { z } from "zod";

export const sourceConfigSchema = z.object({
  enabled: z.boolean(),
  intervalMin: z.number().int().min(1).max(1440),
});

export const categoryRuntimeConfigSchema = z.object({
  enabled: z.boolean(),
  quota: z.number().int().min(0).max(50),
  weight: z.number().min(0).max(100),
});

export const scheduleConfigSchema = z.object({
  enabled: z.boolean(),
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(12),
  jitterMinutes: z.number().int().min(0).max(120),
  timezone: z.string().min(1),
});

export const qualityConfigSchema = z.object({
  minScore: z.number().min(0).max(100),
  rejectDuplicates: z.boolean(),
  duplicateTtlHours: z.number().int().min(1).max(24 * 30),
});

export const fredySettingsSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.enum(["auto", "en", "fa"]),
  channel: z.string().min(1),
  footer: z.string(),
  aiProvider: z.enum(["gemini", "openrouter", "auto"]),
  scheduling: scheduleConfigSchema,
  categories: z.object({
    A: categoryRuntimeConfigSchema,
    B: categoryRuntimeConfigSchema,
    C: categoryRuntimeConfigSchema,
  }),
  sources: z.record(z.string(), sourceConfigSchema),
  quality: qualityConfigSchema,
  approveMode: z.boolean(),
  debugMode: z.boolean(),
});

/** Validate a settings blob. Returns parsed (typed) or throws ZodError. */
export function validateSettings(input: unknown): z.infer<typeof fredySettingsSchema> {
  return fredySettingsSchema.parse(input);
}

/** Safe validation — returns Result-style object. */
export function safeValidateSettings(
  input: unknown,
): { success: true; data: z.infer<typeof fredySettingsSchema> } | { success: false; error: z.ZodError } {
  return fredySettingsSchema.safeParse(input);
}

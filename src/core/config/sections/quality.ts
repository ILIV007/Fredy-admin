/**
 * src/core/config/sections/quality.ts
 * Quality filter thresholds. See FREDY_GUIDELINES.md §9.
 */

import { z } from "zod";

export const qualitySchema = z.object({
  _version: z.literal(1),
  minScore: z.number().min(0).max(100),
  duplicateDetection: z.boolean(),
  duplicateTtlHours: z.number().int().min(1).max(24 * 30),
  spamProtection: z.boolean(),
  spamPatterns: z.array(z.string()).default([
    "\\bjoin\\b", "\\bsubscribe\\b", "\\bfollow\\b",
    "\\bbuy now\\b", "\\bDM me\\b",
  ]),
  minLength: z.number().int().min(0).max(1000),
  maxLength: z.number().int().min(100).max(8192),
  rejectEmptyOutput: z.boolean().default(true),
  rejectWrongLanguage: z.boolean().default(true),
  rejectBrokenHtml: z.boolean().default(true),
});

export type QualityConfig = z.infer<typeof qualitySchema>;

export const qualityDefaults: QualityConfig = {
  _version: 1,
  minScore: 60,
  duplicateDetection: true,
  duplicateTtlHours: 24 * 7,
  spamProtection: true,
  spamPatterns: [
    "\\bjoin\\b", "\\bsubscribe\\b", "\\bfollow\\b",
    "\\bbuy now\\b", "\\bDM me\\b",
  ],
  minLength: 80,
  maxLength: 4096,
  rejectEmptyOutput: true,
  rejectWrongLanguage: true,
  rejectBrokenHtml: true,
};

export const qualitySection = {
  key: "quality",
  version: 1,
  schema: qualitySchema,
  defaults: qualityDefaults,
  description:
    "Minimum quality score, duplicate detection, spam protection, min/max length, and hard reject rules.",
};

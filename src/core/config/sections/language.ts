/**
 * src/core/config/sections/language.ts
 * Language configuration. Supports future language expansion.
 */

import { z } from "zod";

export const languageSchema = z.object({
  _version: z.literal(1),
  default: z.enum(["auto", "en", "fa"]),
  supported: z.array(z.enum(["en", "fa"])).min(1),
  autoDetect: z.boolean(),
});

export type LanguageConfig = z.infer<typeof languageSchema>;

export const languageDefaults: LanguageConfig = {
  _version: 1,
  default: "auto",
  supported: ["en", "fa"],
  autoDetect: true,
};

export const languageSection = {
  key: "language",
  version: 1,
  schema: languageSchema,
  defaults: languageDefaults,
  description:
    "Default language, supported languages, and auto-detection. Add languages by extending the enum.",
};

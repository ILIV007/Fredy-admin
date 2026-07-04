/**
 * src/core/config/sections/nasa.ts
 * NASA APOD-specific configuration. See FREDY_GUIDELINES.md §6.3, §8.
 */

import { z } from "zod";

export const nasaSchema = z.object({
  _version: z.literal(1),
  dailyPost: z.boolean(),
  captionLength: z.number().int().min(100).max(1024),
  imagePreference: z.enum(["hd", "standard"]),
  skipConsecutiveDays: z.boolean().default(true),
  includeVideoAsLink: z.boolean().default(true),
});

export type NasaConfig = z.infer<typeof nasaSchema>;

export const nasaDefaults: NasaConfig = {
  _version: 1,
  dailyPost: true,
  captionLength: 400,
  imagePreference: "hd",
  skipConsecutiveDays: true,
  includeVideoAsLink: true,
};

export const nasaSection = {
  key: "nasa",
  version: 1,
  schema: nasaSchema,
  defaults: nasaDefaults,
  description:
    "NASA APOD daily post toggle, caption length, HD vs standard image, and consecutive-day skip.",
};

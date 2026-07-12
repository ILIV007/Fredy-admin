/**
 * src/core/config/sections/general.ts
 * General bot-wide configuration.
 */

import { z } from "zod";

export const generalSchema = z.object({
  _version: z.literal(1),
  botEnabled: z.boolean(),
  maintenanceMode: z.boolean(),
  environment: z.enum(["development", "staging", "production"]),
  timezone: z.string().min(1),
  channelName: z.string().default("ILIVIR3"),
});

export type GeneralConfig = z.infer<typeof generalSchema>;

export const generalDefaults: GeneralConfig = {
  _version: 1,
  botEnabled: true,
  maintenanceMode: false,
  environment: "production",
  timezone: "Asia/Tehran",
  channelName: "ILIVIR3",
};

export const generalSection = {
  key: "general",
  version: 1,
  schema: generalSchema,
  defaults: generalDefaults,
  description: "Bot-wide toggle, maintenance mode, environment, and timezone.",
};

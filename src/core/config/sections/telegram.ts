/**
 * src/core/config/sections/telegram.ts
 * Telegram channel and admin configuration.
 */

import { z } from "zod";

export const telegramSchema = z.object({
  _version: z.literal(1),
  targetChannel: z.string().min(1),
  adminId: z.string().min(1),
  footer: z.string(),
  parseMode: z.enum(["HTML", "MarkdownV2"]).default("HTML"),
  disableWebPagePreview: z.boolean().default(true),
});

export type TelegramConfig = z.infer<typeof telegramSchema>;

export const telegramDefaults: TelegramConfig = {
  _version: 1,
  targetChannel: "@ILIVIR3",
  adminId: "",
  footer: "🌀 @ILIVIR3",
  parseMode: "HTML",
  disableWebPagePreview: true,
};

export const telegramSection = {
  key: "telegram",
  version: 1,
  schema: telegramSchema,
  defaults: telegramDefaults,
  description: "Target channel, admin ID, footer text, and Telegram parse mode.",
};

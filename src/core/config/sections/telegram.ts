/**
 * src/core/config/sections/telegram.ts
 * Telegram channel and admin configuration.
 * v11.8.0: Added linkPreviewMode (disabled/smart/always).
 */

import { z } from "zod";

export const linkPreviewModes = ["disabled", "smart", "always"] as const;
export type LinkPreviewMode = (typeof linkPreviewModes)[number];

export const telegramSchema = z.object({
  _version: z.literal(1),
  targetChannel: z.string().min(1),
  adminId: z.string().default(""),
  footer: z.string(),
  parseMode: z.enum(["HTML", "MarkdownV2"]).default("HTML"),
  disableWebPagePreview: z.boolean().default(true),
  /** v11.8.0: Link preview mode — disabled, smart (default), always. */
  linkPreviewMode: z.enum(linkPreviewModes).default("smart"),
});

export type TelegramConfig = z.infer<typeof telegramSchema>;

export const telegramDefaults: TelegramConfig = {
  _version: 1,
  targetChannel: "@ILIVIR3",
  adminId: "",
  footer: "🌀 @ILIVIR3",
  parseMode: "HTML",
  disableWebPagePreview: true,
  linkPreviewMode: "smart",
};

export const telegramSection = {
  key: "telegram",
  version: 1,
  schema: telegramSchema,
  defaults: telegramDefaults,
  description: "Target channel, admin ID, footer text, parse mode, and link preview options.",
  /** v11.8.0: Migration — add linkPreviewMode if missing. */
  migrate(_from: number, input: unknown): unknown {
    if (typeof input === "object" && input !== null) {
      const obj = input as Record<string, unknown>;
      if (!obj["linkPreviewMode"]) {
        obj["linkPreviewMode"] = "smart";
      }
    }
    return input;
  },
};

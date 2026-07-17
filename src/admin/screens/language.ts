/**
 * src/admin/screens/language.ts
 * Post Language screen — controls the language of PUBLISHED POSTS.
 *
 * v7.4.5: This is the "Post Language" button in the main menu.
 * It controls the language that AI-generated content is rewritten into.
 * This is DIFFERENT from the bot UI language (which is set on /start).
 *
 * The setting is synced with settings.language.default — the same value
 * that the Settings screen's Language choice controls.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

export const languageScreen: Screen = {
  id: "language",

  async text(ctx) {
    const lang = ctx.settings.language;
    return [
      header("Post Language", "🌐"),
      "",
      kv("Default", lang.default),
      kv("Supported", lang.supported.join(", ")),
      kv("Auto-detect", statusBadge(lang.autoDetect)),
      "",
      divider(),
      "<i>Tap a language below to set it as the default for published posts.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const cur = s.language.default;
    return buildKeyboardWithBack([
      [labelButton("─── Default Post Language ───")],
      [
        { text: cur === "en" ? "✅ English" : "English", callback_data: "set:language:default:en" },
        { text: cur === "fa" ? "✅ فارسی" : "فارسی", callback_data: "set:language:default:fa" },
      ],
      [
        { text: cur === "auto" ? "✅ Auto-detect" : "Auto-detect", callback_data: "set:language:default:auto" },
      ],
      [labelButton("─── Options ───")],
      [
        { text: s.language.autoDetect ? "🟢 Auto-detect: ON" : "🔴 Auto-detect: OFF", callback_data: "set:language:autodetect:toggle" },
      ],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 4 || parts[0] !== "set" || parts[1] !== "language") return;
    const field = parts[2] ?? "";
    const value = parts[3] ?? "";

    let patch: Partial<FredySettings> = {};

    if (field === "default") {
      const validLangs = ["auto", "en", "fa"];
      if (!validLangs.includes(value)) {
        return { alert: `❌ Invalid language: ${value}` };
      }
      patch = { language: { ...ctx.settings.language, default: value as "auto" | "en" | "fa" } };
    } else if (field === "autodetect" && value === "toggle") {
      patch = { language: { ...ctx.settings.language, autoDetect: !ctx.settings.language.autoDetect } };
    } else {
      return;
    }

    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) {
      return { alert: `❌ Validation failed: ${result.error}` };
    }
    return { toast: `✅ Post language updated` };
  },
};

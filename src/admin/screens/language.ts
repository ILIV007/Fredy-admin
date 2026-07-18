/**
 * src/admin/screens/language.ts
 * Post Language screen — edits settings.language.default and autoDetect.
 *
 * Callbacks:
 *   set:language:default:<en|fa|auto>  — set default post language
 *   set:language:autodetect:toggle     — toggle auto-detect
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

type LangValue = "en" | "fa" | "auto";

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
      "<i>Choose the default language for generated posts.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const cur: LangValue = s.language.default;
    const mk = (v: LangValue): string =>
      cur === v ? `✓ ${v}` : v;
    return buildKeyboardWithBack([
      [labelButton("─── Default language ───")],
      [
        { text: mk("auto"), callback_data: "set:language:default:auto" },
        { text: mk("en"), callback_data: "set:language:default:en" },
        { text: mk("fa"), callback_data: "set:language:default:fa" },
      ],
      [labelButton("─── Auto-detect ───")],
      [
        {
          text: s.language.autoDetect ? "🟢 Auto-detect: ON" : "🔴 Auto-detect: OFF",
          callback_data: "set:language:autodetect:toggle",
        },
      ],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: set:language:<field>[:<value>]
    if (parts.length < 4 || parts[0] !== "set" || parts[1] !== "language") return;
    const field = parts[2] ?? "";
    const value = parts[3] ?? "";

    let patch: Partial<FredySettings> = {};

    if (field === "default") {
      const langVal = value as LangValue;
      if (!["auto", "en", "fa"].includes(langVal)) {
        return { alert: `❌ Invalid language: ${value}` };
      }
      patch = {
        language: { ...ctx.settings.language, default: langVal },
      };
    } else if (field === "autodetect" && value === "toggle") {
      patch = {
        language: { ...ctx.settings.language, autoDetect: !ctx.settings.language.autoDetect },
      };
    }

    if (Object.keys(patch).length === 0) return;

    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) {
      return { alert: `❌ Validation failed: ${result.error}` };
    }
    return { toast: "✅ Language updated" };
  },
};

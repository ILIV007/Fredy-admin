/**
 * src/admin/screens/strategy.ts
 * Strategy screen — let admin pick a publishing strategy (Minimal/Balanced/Active/
 * AI Priority/News Priority/Custom) directly from the Telegram bot.
 *
 * Updates the `strategy` section of FredySettings. The new mode takes effect
 * on the next daily-plan generation — no redeployment required.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard, InlineKeyboardButton } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, labelButton } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";
import { BUILTIN_STRATEGIES } from "../../core/config/sections/strategy";

export const strategyScreen: Screen = {
  id: "strategy",

  async text(ctx) {
    const s = ctx.settings.strategy;
    const def = BUILTIN_STRATEGIES[s.mode];
    const dist = def?.distribution
      ?? { A: s.customDistribution.A, B: s.customDistribution.B, C: s.customDistribution.C, total: s.customDistribution.A + s.customDistribution.B + s.customDistribution.C };
    return [
      header("Strategy", "🎯"),
      "",
      kv("Active mode", def?.name ?? s.mode),
      kv("Description", def?.description ?? "(custom)"),
      kv("Distribution", `A:${dist.A}  B:${dist.B}  C:${dist.C}  (total ${dist.total}/day)`),
      kv("Weekly themes", statusBadge(s.weeklyThemesEnabled)),
      kv("Language", s.language),
      kv("Quality threshold", s.qualityThreshold),
      "",
      divider(),
      "<i>Tap a strategy below to activate it.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const rows: InlineKeyboardButton[][] = [];
    rows.push([labelButton("─── Strategy Modes ───")]);
    for (const def of Object.values(BUILTIN_STRATEGIES)) {
      const isActive = s.strategy.mode === def.mode;
      rows.push([{
        text: `${isActive ? "✅ " : ""}${def.name} — ${def.description}`,
        callback_data: `set:strategy:mode:${def.mode}`,
      }]);
    }
    rows.push([labelButton("─── Options ───")]);
    rows.push([toggleButton("Weekly themes", s.strategy.weeklyThemesEnabled, "set:strategy:themes:toggle")]);
    return buildKeyboardWithBack(rows);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 4 || parts[0] !== "set" || parts[1] !== "strategy") return;
    const field = parts[2] ?? "";
    const value = parts[3] ?? "";

    let patch: Partial<FredySettings> = {};

    if (field === "mode") {
      const validModes = ["minimal", "balanced", "active", "ai_priority", "news_priority", "custom"];
      if (!validModes.includes(value)) {
        return { alert: `❌ Invalid mode: ${value}` };
      }
      patch = { strategy: { ...ctx.settings.strategy, mode: value as typeof ctx.settings.strategy.mode } };
    } else if (field === "themes" && value === "toggle") {
      patch = { strategy: { ...ctx.settings.strategy, weeklyThemesEnabled: !ctx.settings.strategy.weeklyThemesEnabled } };
    } else if (field === "lang") {
      const validLangs = ["fa", "en", "auto"];
      if (!validLangs.includes(value)) {
        return { alert: `❌ Invalid language: ${value}` };
      }
      patch = { strategy: { ...ctx.settings.strategy, language: value as "fa" | "en" | "auto" } };
    } else {
      return;
    }

    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) {
      return { alert: `❌ Validation failed: ${result.error}` };
    }
    return { toast: `✅ Strategy updated` };
  },
};

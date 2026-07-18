/**
 * src/admin/screens/strategy.ts
 * Strategy screen — switch between built-in publishing strategies.
 *
 * Callbacks:
 *   set:strategy:mode:<mode>  — switch strategy mode
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { BUILTIN_STRATEGIES } from "../../core/config/sections/strategy";
import type { StrategyMode } from "../../types/strategy";
import { buildKeyboardWithBack } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

export const strategyScreen: Screen = {
  id: "strategy",

  async text(ctx) {
    const strat = ctx.settings.strategy;
    const def = BUILTIN_STRATEGIES[strat.mode];
    const dist = def?.distribution ?? strat.customDistribution;
    const total = "total" in dist ? dist.total : (dist.A + dist.B + dist.C);
    return [
      header("Strategy", "🎯"),
      "",
      kv("Mode", strat.mode),
      kv("Name", def?.name ?? "(custom)"),
      kv("Description", def?.description ?? "(no description)"),
      kv("Distribution (A/B/C)", `${dist.A}/${dist.B}/${dist.C} (total ${total})`),
      kv("Weekly themes", statusBadge(strat.weeklyThemesEnabled)),
      kv("Quality threshold", String(strat.qualityThreshold)),
      "",
      divider(),
      "<i>Tap a mode below to switch strategy.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const cur = s.strategy.mode;
    const modes: StrategyMode[] = [
      "minimal",
      "balanced",
      "active",
      "ai_priority",
      "news_priority",
      "custom",
    ];
    const mk = (m: StrategyMode): string => cur === m ? `✓ ${m}` : m;
    const rows: { text: string; callback_data: string }[][] = [
      [{ text: "─── Strategy mode ───", callback_data: "ignore" }],
      ...modes.map((m) => [
        { text: mk(m), callback_data: `set:strategy:mode:${m}` },
      ]),
    ];
    return buildKeyboardWithBack(rows);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: set:strategy:mode:<mode>
    if (parts.length < 4 || parts[0] !== "set" || parts[1] !== "strategy") return;
    const field = parts[2] ?? "";
    const value = parts[3] ?? "";

    if (field === "mode") {
      const validModes: StrategyMode[] = [
        "minimal", "balanced", "active",
        "ai_priority", "news_priority", "custom",
      ];
      if (!validModes.includes(value as StrategyMode)) {
        return { alert: `❌ Invalid strategy mode: ${value}` };
      }
      const oldMode = ctx.settings.strategy.mode;
      const patch: Partial<FredySettings> = {
        strategy: { ...ctx.settings.strategy, mode: value as StrategyMode },
      };
      const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
      if (!result.ok) {
        return { alert: `❌ Validation failed: ${result.error}` };
      }

      // v8.2.0: When strategy mode changes, clear today's plan + regenerate.
      // Also notify admin about the strategy change.
      if (value !== oldMode) {
        try {
          const { formatDateInZone } = await import("../../primitives/time");
          const { slotsKey } = await import("../../core/storage/keys");
          const settings = await ctx.container.config.getSettings(ctx.adminId);
          const today = formatDateInZone(Date.now(), settings.scheduler.timezone);
          // Delete today's plan.
          await ctx.container.kv.delete(slotsKey(today));
          // Generate a new plan with the new strategy.
          await ctx.container.strategyEngine.generatePlan();

          // Notify admin about strategy change.
          await ctx.container.tg.sendMessage(ctx.adminId, [
            `╔══════════════════════════╗`,
            `   🎯 STRATEGY CHANGED`,
            `╚══════════════════════════╝`,
            ``,
            `<blockquote>📊 <b>Old:</b> ${oldMode}</blockquote>`,
            `<blockquote>📊 <b>New:</b> ${value}</blockquote>`,
            `<blockquote>📅 <b>Date:</b> ${today}</blockquote>`,
            `<blockquote>🔄 <b>Plan regenerated with new strategy.</b></blockquote>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        } catch (e) {
          console.warn("[strategy] plan regeneration failed:", e);
        }
      }

      return { toast: `✅ Strategy set to ${value}` };
    }
  },
};

/**
 * src/admin/screens/stats.ts
 * Stats screen — global and per-admin statistics.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton } from "../keyboards";
import { header, kv, formatNumber, divider, formatRelativeTime } from "../helpers/formatting";

export const statsScreen: Screen = {
  id: "stats",

  async text(ctx) {
    const global = await ctx.container.kv.getGlobalStats();
    const state = await ctx.container.config.getState(ctx.adminId);

    return [
      header("Statistics", "📊"),
      "",
      header("Global", "🌍"),
      kv("Processed", formatNumber(global.processed)),
      kv("Published", formatNumber(global.published)),
      kv("Rejected", formatNumber(global.rejected)),
      kv("Failed", formatNumber(global.failed)),
      "",
      header("Today", "📅"),
      kv("Date", state.today.date),
      kv("Slots fired", state.today.slotsFired.length),
      kv("A published", state.today.categoriesPublished.A),
      kv("B published", state.today.categoriesPublished.B),
      kv("C published", state.today.categoriesPublished.C),
      "",
      header("Last", "⏱️"),
      kv("Published", formatRelativeTime(state.lastPublishedAt)),
      kv("Source", state.lastSource ?? "(none)"),
      kv("Category", state.lastCategory ?? "(none)"),
      "",
      divider(),
      "<i>Stats are batched and flushed every 10 increments.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    void s;
    return buildKeyboardWithBack([
      [labelButton("─── Actions ───")],
      [{ text: "🔄 Refresh", callback_data: "action:stats:refresh" }],
      [{ text: "🗑️ Reset Stats", callback_data: "action:stats:reset" }],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 3 || parts[0] !== "action" || parts[1] !== "stats") return;
    const action = parts[2];

    if (action === "refresh") {
      return { toast: "🔄 Stats refreshed" };
    }

    if (action === "reset") {
      // Reset global stats.
      await ctx.container.kv.set("fredy:global:stats", JSON.stringify({
        processed: 0, published: 0, rejected: 0, failed: 0, _count: 0,
      })).catch(() => {});
      // Reset state stats.
      await ctx.container.config.resetState(ctx.adminId).catch(() => {});
      return { toast: "🗑️ Stats reset" };
    }
  },
};

/**
 * src/admin/screens/stats.ts
 * Stats screen — global and per-admin statistics.
 */

import type { Screen } from "../registry";
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
      [{ text: "🔄 Refresh", callback_data: "ignore" }],
      [{ text: "🗑️ Reset Stats", callback_data: "action:stats:reset" }],
    ]);
  },
};

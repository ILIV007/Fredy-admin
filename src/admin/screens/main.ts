/**
 * src/admin/screens/main.ts
 * Dashboard screen. Shows Fredy status at a glance.
 * See FREDY_GUIDELINES.md §5.3 (proposed Fredy main menu).
 */

import type { Screen } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboard, navRow } from "../keyboards";
import { header, kv, statusBadge, formatNumber, divider } from "../helpers/formatting";

export const mainScreen: Screen = {
  id: "main",

  async text(ctx) {
    const { container, adminId } = ctx;
    const settings = await container.config.getSettings(adminId);
    const stats = await container.kv.getGlobalStats();
    const state = await container.config.getState(adminId);

    const lines = [
      header("Fredy Dashboard", "📊"),
      "",
      kv("Bot", settings.general.botEnabled ? "🟢 Active" : "🔴 Disabled"),
      kv("Maintenance", settings.general.maintenanceMode ? "🟡 ON" : "OFF"),
<<<<<<< HEAD
      kv("Version", "3.3.0"),
=======
      kv("Version", "0.5.0"),
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
      kv("Channel", settings.telegram.targetChannel),
      kv("Language", settings.language.default),
      kv("AI Provider", settings.ai.primaryProvider),
      kv("Scheduler", statusBadge(settings.scheduler.enabled)),
      kv("Posts/day", settings.content.postsPerDay),
      "",
      header("Today", "📅"),
      kv("Date", state.today.date),
      kv("Slots fired", `${state.today.slotsFired.length} / ${settings.scheduler.slots.length}`),
      kv("A published", state.today.categoriesPublished.A),
      kv("B published", state.today.categoriesPublished.B),
      kv("C published", state.today.categoriesPublished.C),
      "",
      header("Global Stats", "📈"),
      kv("Processed", formatNumber(stats.processed)),
      kv("Published", formatNumber(stats.published)),
      kv("Rejected", formatNumber(stats.rejected)),
      kv("Failed", formatNumber(stats.failed)),
      "",
      divider(),
      "<i>Tap a button below to navigate.</i>",
    ];
    return lines.join("\n");
  },

  keyboard(settings: FredySettings): InlineKeyboard {
    void settings;
    return buildKeyboard([
      navRow(
        { text: "📅 Scheduler", target: "menu:schedule" },
        { text: "📚 Categories", target: "menu:categories" },
      ),
      navRow(
        { text: "🔌 Providers", target: "menu:providers" },
        { text: "🤖 AI", target: "menu:ai" },
      ),
      navRow(
        { text: "⚙️ Settings", target: "menu:settings" },
        { text: "✍️ Manual", target: "menu:manual" },
      ),
      navRow(
        { text: "📝 Soul.md", target: "menu:soul" },
        { text: "🐛 Debug", target: "menu:debug" },
      ),
      [{ text: "📊 Stats", callback_data: "menu:stats" }],
    ]);
  },
};

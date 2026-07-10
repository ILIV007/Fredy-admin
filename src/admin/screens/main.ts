/**
 * src/admin/screens/main.ts
 * Dashboard screen — bot status at a glance.
 * Bot ON/OFF toggle is the first button, alone in its row.
 */

import type { Screen } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboard, navRow } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

export const mainScreen: Screen = {
  id: "main",

  async text(ctx) {
    const { container, adminId } = ctx;
    const settings = await container.config.getSettings(adminId);

    const lines = [
      header("Fredy Dashboard", "📊"),
      "",
      kv("Bot", settings.general.botEnabled ? "🟢 Active" : "🔴 Disabled"),
      kv("Maintenance", settings.general.maintenanceMode ? "🟡 ON" : "OFF"),
      kv("Version", "2.2.0"),
      kv("Channel", settings.telegram.targetChannel),
      kv("Language", settings.language.default),
      kv("AI Provider", settings.ai.primaryProvider),
      kv("Scheduler", statusBadge(settings.scheduler.enabled)),
      kv("Approve Mode", statusBadge(settings.approveMode)),
      "",
      divider(),
      "<i>Tap a button below to navigate.</i>",
    ];
    return lines.join("\n");
  },

  keyboard(settings: FredySettings): InlineKeyboard {
    return buildKeyboard([
      // Bot ON/OFF — first row, ALONE
      [
        { text: settings.general.botEnabled ? "🟢 Bot: ON" : "🔴 Bot: OFF", callback_data: "toggle:botEnabled" },
      ],
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
        { text: "✍️ Manual Post", target: "menu:manual" },
      ),
      [
        { text: settings.approveMode ? "🔐 Approve: ON ✅" : "🔓 Approve: OFF", callback_data: "toggle:approve" },
        { text: "📊 Stats", callback_data: "menu:stats" },
      ],
      [
        { text: "🐛 Debug", callback_data: "menu:debug" },
      ],
    ]);
  },
};

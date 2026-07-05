/**
 * src/admin/screens/main.ts
 * Dashboard screen — bot status at a glance.
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
      kv("Version", "1.6.0"),
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
      navRow(
        { text: toggleApproveLabel(settings.approveMode), target: "toggle:approve" },
        { text: "📊 Stats", target: "menu:stats" },
      ),
      [
        { text: "🐛 Debug", callback_data: "menu:debug" },
      ],
    ]);
  },
};

function toggleApproveLabel(on: boolean): string {
  return on ? "🔐 Approve: ON" : "🔓 Approve: OFF";
}

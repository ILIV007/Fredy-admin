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
import { APP_VERSION } from "../../core/constants";

export const mainScreen: Screen = {
  id: "main",

  async text(ctx) {
    const { container, adminId } = ctx;
    const settings = await container.config.getSettings(adminId);

    // Use optional chaining everywhere — if any section is missing, show (none) instead of crashing.
    const lines = [
      header("Fredy Dashboard", "📊"),
      "",
      kv("Bot", settings?.general?.botEnabled ? "🟢 Active" : "🔴 Disabled"),
      kv("Maintenance", settings?.general?.maintenanceMode ? "🟡 ON" : "OFF"),
      kv("Version", APP_VERSION),
      kv("Channel", settings?.telegram?.targetChannel ?? "(none)"),
      kv("Language", settings?.language?.default ?? "(none)"),
      kv("AI Provider", settings?.ai?.primaryProvider ?? "(none)"),
      kv("Scheduler", statusBadge(settings?.scheduler?.enabled ?? false)),
      kv("Approve Mode", statusBadge(settings?.approveMode ?? false)),
      "",
      divider(),
      "<i>Tap a button below to navigate.</i>",
    ];
    return lines.join("\n");
  },

  keyboard(settings: FredySettings, ctx?: { container: { env: { MANAGER_URL?: string } } }): InlineKeyboard {
    const botEnabled = settings?.general?.botEnabled ?? true;
    const approveMode = settings?.approveMode ?? false;
    const managerUrl = ctx?.container?.env?.MANAGER_URL;
    return buildKeyboard([
      [
        { text: botEnabled ? "🟢 Bot: ON" : "🔴 Bot: OFF", callback_data: "toggle:botEnabled" },
      ],
      navRow(
        { text: "🌐 Post Language", target: "menu:language" },
        { text: "📅 Scheduler", target: "menu:schedule" },
      ),
      navRow(
        { text: "📚 Categories", target: "menu:categories" },
        { text: "🔌 Providers", target: "menu:providers" },
      ),
      navRow(
        { text: "🤖 AI", target: "menu:ai" },
        { text: "✍️ Manual Post", target: "menu:manual" },
      ),
      navRow(
        { text: "⚙️ Settings", target: "menu:settings" },
        { text: "🎨 Editor", target: "menu:editor" },
      ),
      [
        { text: approveMode ? "🔐 Approve: ON ✅" : "🔓 Approve: OFF", callback_data: "toggle:approve" },
        managerUrl
          ? { text: "🖥️ Manager", url: managerUrl }
          : { text: "📊 Stats", callback_data: "menu:stats" },
      ],
      [
        { text: "🐛 Debug", callback_data: "menu:debug" },
      ],
    ]);
  },
};

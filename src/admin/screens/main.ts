/**
 * src/admin/screens/main.ts
 * Dashboard screen — bot status at a glance.
 * Bot ON/OFF toggle is the first button, alone in its row.
 */

import type { Screen, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard, InlineKeyboardButton } from "../../types/telegram";
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

  keyboard(settings: FredySettings, ctx?: ScreenContext): InlineKeyboard {
    // Use safe defaults if settings sections are missing.
    const botEnabled = settings?.general?.botEnabled ?? true;
    const approveMode = settings?.approveMode ?? false;

    const rows: InlineKeyboardButton[][] = [
      // Bot ON/OFF — first row, ALONE
      [
        { text: botEnabled ? "🟢 Bot: ON" : "🔴 Bot: OFF", callback_data: "toggle:botEnabled" },
      ],
      [...navRow(
        { text: "📅 Scheduler", target: "menu:schedule" },
        { text: "📚 Categories", target: "menu:categories" },
      )],
      [...navRow(
        { text: "🔌 Providers", target: "menu:providers" },
        { text: "🤖 AI", target: "menu:ai" },
      )],
      [...navRow(
        { text: "🌐 Language", target: "menu:language" },
        { text: "🎯 Strategy", target: "menu:strategy" },
      )],
      [...navRow(
        { text: "⚙️ Settings", target: "menu:settings" },
        { text: "✍️ Manual Post", target: "menu:manual" },
      )],
      [...navRow(
        { text: "🎨 Editor", target: "menu:editor" },
        { text: "🔄 Refresh", target: "menu:main" },
      )],
      [
        { text: approveMode ? "🔐 Approve: ON ✅" : "🔓 Approve: OFF", callback_data: "toggle:approve" },
        { text: "📊 Stats", callback_data: "menu:stats" },
      ],
      [
        { text: "🐛 Debug", callback_data: "menu:debug" },
      ],
    ];

    // Manager URL button (only if env var is set).
    const managerUrl = ctx?.container?.env?.MANAGER_URL;
    if (managerUrl) {
      rows.push([{ text: "🎛️ Manager", url: managerUrl, callback_data: "ignore" }]);
    }

    return buildKeyboard(rows);
  },
};

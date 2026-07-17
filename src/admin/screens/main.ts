/**
 * src/admin/screens/main.ts
 * Dashboard screen — bot status at a glance + main menu.
 *
 * v7.4.0 menu layout:
 *   Row 1: Bot ON/OFF (alone)
 *   Row 2: 🎯 Strategy | 📅 Scheduler
 *   Row 3: 📚 Categories | 🔌 Providers
 *   Row 4: 🤖 AI | ✍️ Manual Post
 *   Row 5: ⚙️ Settings | 🎨 Editor
 *   Row 6: Approve toggle | 🖥️ Manager (URL button)
 *   Row 7: 🐛 Debug
 *
 * Removed: "🔄 Refresh" (replaced by Manager URL), "📊 Stats" (the dashboard
 * text itself already shows key stats; Stats screen still accessible via
 * /stats command).
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

    // Pull live stats so the dashboard is genuinely useful at a glance.
    let postsToday = 0;
    let queueTotal = 0;
    let nextSlot = "(unknown)";
    try {
      const schedStatus = await container.scheduler.status();
      postsToday = schedStatus.postsPublishedToday ?? 0;
      queueTotal = schedStatus.queueDepth ?? 0;
      nextSlot = schedStatus.nextSlot ? new Date(schedStatus.nextSlot.epochMs).toLocaleString() : "(none scheduled)";
    } catch { /* non-fatal */ }

    const lines = [
      header("Fredy Dashboard", "📊"),
      "",
      kv("Bot", settings?.general?.botEnabled ? "🟢 Active" : "🔴 Disabled"),
      kv("Maintenance", settings?.general?.maintenanceMode ? "🟡 ON" : "OFF"),
      kv("Version", APP_VERSION),
      kv("Channel", settings?.telegram?.targetChannel ?? "(none)"),
      kv("Language", settings?.language?.default ?? "(none)"),
      kv("AI Provider", settings?.ai?.primaryProvider ?? "(none)"),
      kv("Strategy", settings?.strategy?.mode ?? "(none)"),
      kv("Scheduler", statusBadge(settings?.scheduler?.enabled ?? false)),
      kv("Approve Mode", statusBadge(settings?.approveMode ?? false)),
      "",
      header("Live", "📈"),
      kv("Posts today", String(postsToday)),
      kv("Queue depth", String(queueTotal)),
      kv("Next slot", nextSlot),
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
    const managerUrl = ctx?.container?.env?.MANAGER_URL;

    // Row 6: Approve toggle + Manager URL (or Refresh if no URL configured)
    const managerButton: InlineKeyboardButton = managerUrl
      ? { text: "🖥️ Manager", url: managerUrl }
      : { text: "🔄 Refresh", callback_data: "menu:main" };

    return buildKeyboard([
      // Row 1: Bot ON/OFF alone
      [
        { text: botEnabled ? "🟢 Bot: ON" : "🔴 Bot: OFF", callback_data: "toggle:botEnabled" },
      ],
      // Row 2: Language + Strategy
      navRow(
        { text: "🌐 Language", target: "menu:language" },
        { text: "🎯 Strategy", target: "menu:strategy" },
      ),
      // Row 3: Scheduler + Categories
      navRow(
        { text: "📅 Scheduler", target: "menu:schedule" },
        { text: "📚 Categories", target: "menu:categories" },
      ),
      // Row 4: Providers + AI
      navRow(
        { text: "🔌 Providers", target: "menu:providers" },
        { text: "🤖 AI", target: "menu:ai" },
      ),
      // Row 5: Manual Post + Settings
      navRow(
        { text: "✍️ Manual Post", target: "menu:manual" },
        { text: "⚙️ Settings", target: "menu:settings" },
      ),
      // Row 6: Editor + Approve toggle
      [
        { text: "🎨 Editor", callback_data: "menu:editor" },
        { text: approveMode ? "🔐 Approve: ON ✅" : "🔓 Approve: OFF", callback_data: "toggle:approve" },
      ],
      // Row 7: Manager URL (or Refresh fallback) + Debug
      [
        managerButton,
        { text: "🐛 Debug", callback_data: "menu:debug" },
      ],
    ]);
  },
};

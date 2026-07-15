/**
 * src/admin/screens/debug.ts
 * Debug screen — health, logs, KV, environment, queue, AI, plugins.
 *
 * Provides quick access to debug endpoints from inside Telegram.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton, navButton, toggleButton } from "../keyboards";
import { header, kv, statusBadge, divider, formatRelativeTime } from "../helpers/formatting";

export const debugScreen: Screen = {
  id: "debug",

  async text(ctx) {
    const status = await ctx.container.debug.getStatus().catch(() => null);
    const counts = await ctx.container.logger.counts().catch(() => ({ updates: 0, errors: 0, rawRequests: 0 }));

    return [
      header("Debug", "🐛"),
      "",
      kv("Debug mode", statusBadge(ctx.settings.debug.enabled)),
      kv("Log level", ctx.settings.debug.logLevel),
      kv("Simulation", statusBadge(ctx.settings.debug.simulationMode)),
      kv("Verbose", statusBadge(ctx.settings.debug.verboseOutput)),
      "",
      header("Ring Buffers", "📊"),
      kv("Updates", counts.updates),
      kv("Errors", counts.errors),
      kv("Raw requests", counts.rawRequests),
      kv("Capacity", ctx.settings.debug.ringBufferCapacity),
      "",
      header("Environment", "🌍"),
      status ? kv("Has bot token", status.env.has_bot_token ? "✅" : "❌") : "",
      status ? kv("Has KV", status.env.has_kv ? "✅" : "❌") : "",
      status ? kv("Has Gemini key", status.env.has_gemini ? "✅" : "❌") : "",
      status ? kv("Has OpenRouter key", status.env.has_openrouter ? "✅" : "❌") : "",
      "",
      divider(),
      "<i>Open /debug in a browser for the full dashboard.</i>",
    ].filter((line) => line !== "").join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    return buildKeyboardWithBack([
      [toggleButton("Debug mode", s.debug.enabled, "set:debug:enabled:toggle")],
      [toggleButton("Simulation", s.debug.simulationMode, "set:debug:simulation:toggle")],
      [toggleButton("Verbose", s.debug.verboseOutput, "set:debug:verbose:toggle")],
      [labelButton("─── Quick Tests ───")],
      [navButton("🧪 Test KV", "action:debug:testKv")],
      [navButton("🧪 Test Telegram", "action:debug:testTelegram")],
      [navButton("🧪 Test Cron Queue", "action:debug:testCron")],
      [labelButton("─── Logs ───")],
      [navButton("📜 Recent Updates", "action:debug:logs:updates")],
      [navButton("📜 Recent Errors", "action:debug:logs:errors")],
      [navButton("📜 Recent Raw", "action:debug:logs:raw")],
      [navButton("🗑️ Clear Logs", "action:debug:clear")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: "set:debug:<field>:<action>" or "set:debug:<field>:<action>:<extra>"
    //      or "action:debug:<op>" or "action:debug:logs:<which>"
    if (parts.length < 3) return;
    const first = parts[0] ?? "";
    const second = parts[1] ?? "";
    const third = parts[2] ?? "";
    const fourth = parts[3] ?? "";
    // parts[4] is unused — removed.

    // Handle "set:debug:<field>:<action>"
    if (first === "set" && second === "debug") {
      const d = ctx.settings.debug;
      let patch: Partial<FredySettings> = {};
      if (third === "enabled" && fourth === "toggle") patch = { debug: { ...d, enabled: !d.enabled } };
      else if (third === "simulation" && fourth === "toggle") patch = { debug: { ...d, simulationMode: !d.simulationMode } };
      else if (third === "verbose" && fourth === "toggle") patch = { debug: { ...d, verboseOutput: !d.verboseOutput } };
      if (Object.keys(patch).length === 0) return;
      const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
      if (!result.ok) return { alert: `❌ ${result.error}` };
      return { toast: "✅ Updated" };
    }

    // Handle "action:debug:<op>" or "action:debug:logs:<which>"
    if (first === "action" && second === "debug") {
      const op = third;

      if (op === "testKv") {
        const result = await ctx.container.debug.testKv();
        return result.ok
          ? { toast: "✅ KV OK" }
          : { alert: `❌ KV test failed: ${result.error}` };
      }

      if (op === "testTelegram") {
        const result = await ctx.container.debug.testTelegramMessage(
          ctx.adminId,
          `🧪 Debug test at ${new Date().toISOString()}`,
        );
        return result.ok
          ? { toast: "✅ Telegram OK" }
          : { alert: `❌ Telegram test failed: ${result.error}` };
      }

      if (op === "testCron") {
        return { toast: "🧪 Cron test — check logs (skeleton)" };
      }

      if (op === "clear") {
        await ctx.container.debug.clearLogs();
        return { toast: "🗑️ Logs cleared" };
      }

      if (op === "logs") {
        const which = fourth;
        let events: readonly { readonly time: number; readonly event: string; readonly level: string }[];
        if (which === "updates") events = await ctx.container.debug.getRecentUpdates();
        else if (which === "errors") events = await ctx.container.debug.getRecentErrors();
        else if (which === "raw") events = await ctx.container.debug.getRecentRawRequests();
        else return;

        const text = events.length === 0
          ? "(no entries)"
          : events.slice(0, 10).map((e) => `[${e.level}] ${formatRelativeTime(e.time)} ${e.event}`).join("\n");
        return { alert: text.slice(0, 200) };
      }
    }
  },
};

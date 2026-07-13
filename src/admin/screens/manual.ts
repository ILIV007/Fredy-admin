/**
 * src/admin/screens/manual.ts
 * Manual Actions screen — send category A/B/C, send NASA, send specific plugin.
 *
 * Triggers immediate pipeline runs without waiting for the scheduler.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import type { Category } from "../../types/category";
import { buildKeyboardWithBack, labelButton, navButton } from "../keyboards";
import { header, divider, kv } from "../helpers/formatting";

export const manualScreen: Screen = {
  id: "manual",

  async text(ctx) {
    const plugins = ctx.container.plugins.list();
    return [
      header("Manual Actions", "✍️"),
      "",
      "Trigger an immediate post. The pipeline runs once and publishes to the channel.",
      "",
      header("By Category", "📚"),
      kv("A", "Dev content (programming, AI, GitHub, tools)"),
      kv("B", "Tech news"),
      kv("C", "NASA / joke / quote / fact"),
      "",
      header("By Source", "🔌"),
      ...plugins.map((p) => kv(p.metadata.name, `${p.metadata.id} (${p.metadata.category})`)),
      "",
      divider(),
      "<i>Tap an action to run it now.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    void s;
    return buildKeyboardWithBack([
      [labelButton("─── By Category ───")],
      [navButton("🟢 Send Category A", "action:manual:category:A")],
      [navButton("🟡 Send Category B", "action:manual:category:B")],
      [navButton("🟣 Send Category C", "action:manual:category:C")],
      [labelButton("─── By Source ───")],
      [navButton("📦 Send GitHub", "action:manual:source:github")],
      [navButton("📰 Send News", "action:manual:source:news")],
      [navButton("🪐 Send NASA", "action:manual:source:nasa")],
      [navButton("😄 Send Joke", "action:manual:source:joke")],
      [navButton("🚀 Send HackerNews", "action:manual:source:hackernews")],
      [navButton("🛠️ Send Dev.to", "action:manual:source:devto")],
      [labelButton("─── Special ───")],
      [navButton("🧪 Simulate (no publish)", "action:manual:simulate")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: action:manual:<type>:<arg>
    if (parts.length < 3 || parts[0] !== "action" || parts[1] !== "manual") return;
    const type = parts[2] ?? "";
    const arg = parts[3] ?? "";

    if (type === "simulate") {
      return { toast: "🧪 Simulation not implemented yet" };
    }

    if (type === "category") {
      if (!["A", "B", "C"].includes(arg)) {
        return { alert: "❌ Invalid category" };
      }
      try {
        const result = await ctx.container.content.processForCategory(
          arg as Category,
          null,
          "en",
        );
        if (result.ok && result.content) {
          // Publish immediately.
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            return { toast: `✅ Published from category ${arg}!` };
          }
          return { alert: `❌ Publish failed: ${pubResult.error ?? "unknown"}` };
        }
        return { alert: `❌ No content available for category ${arg}: ${result.error ?? "all rejected"}` };
      } catch (error) {
        return { alert: `❌ Error: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (type === "source") {
      if (!arg) {
        return { alert: "❌ Missing source ID" };
      }
      try {
        const items = await ctx.container.plugins.fetchFrom(arg);
        if (items.length === 0) {
          return { alert: `❌ No items from ${arg}` };
        }
        const result = await ctx.container.content.process(items[0]!, "en", { skipDedup: true });
        if (result.ok && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // Also notify the admin chat with details.
            await ctx.container.tg.sendMessage(ctx.adminId, [
              `✅ <b>Manual post published</b>`,
              ``,
              `<b>Source:</b> ${arg}`,
              `<b>Message ID:</b> ${pubResult.telegramMessageId}`,
              `<b>Quality:</b> ${result.content.quality.overallScore}`,
              `<b>AI:</b> ${result.content.aiProvider}/${result.content.aiModel}`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ Published from ${arg}!` };
          }
          return { alert: `❌ Publish failed: ${pubResult.error ?? "unknown"}` };
        }
        return { alert: `❌ Processing failed: ${result.error ?? "rejected"}` };
      } catch (error) {
        return { alert: `❌ Error: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  },
};

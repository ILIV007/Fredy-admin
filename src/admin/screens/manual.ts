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
      [navButton("📦 GitHub", "action:manual:source:github")],
      [navButton("🚀 GitHub Trending", "action:manual:source:github-trending")],
      [navButton("🏷️ GitHub Releases", "action:manual:source:github-releases")],
      [navButton("🛠️ Dev.to", "action:manual:source:devto")],
      [navButton("📚 Stack Exchange", "action:manual:source:stackexchange")],
      [navButton("📰 News", "action:manual:source:news")],
      [navButton("🔥 Hacker News", "action:manual:source:hackernews")],
      [navButton("🪐 NASA", "action:manual:source:nasa")],
      [navButton("😄 Joke", "action:manual:source:joke")],
      [navButton("🎨 XKCD", "action:manual:source:xkcd")],
      [navButton("📜 Wikimedia", "action:manual:source:wikimedia")],
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
        const settings = await ctx.container.config.getSettings(ctx.adminId);
        const lang = settings?.language?.default ?? "auto";
        const result = await ctx.container.content.processForCategory(
          arg as Category,
          null,
          lang,
        );
        if (result.ok && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // Send the formatted post to admin PM (transformed via UX layer).
            try {
              const finalPost = await ctx.container.uxLayer.transform(result.content);
              await ctx.container.tg.sendMessage(ctx.adminId, finalPost.fullText, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
              }).catch(() => {});
            } catch { /* if transform fails, skip PM */ }
            await ctx.container.tg.sendMessage(ctx.adminId, [
              `📤 <b>Published from category ${arg}</b>`,
              `<b>AI:</b> ${result.content.aiProvider}/${result.content.aiModel}`,
              `<b>Quality:</b> ${result.content.quality.overallScore}`,
              `<b>Msg ID:</b> ${pubResult.telegramMessageId}`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ Category ${arg} published!`, redirectTo: "menu:main" };
          }
          return { alert: `❌ Publish failed: ${pubResult.error ?? "unknown"}` };
        }
        return { alert: `❌ No content for ${arg}` };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
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
        const settings = await ctx.container.config.getSettings(ctx.adminId);
        const lang = settings?.language?.default ?? "auto";
        // Try up to 5 items until one passes.
        let result = null;
        for (let i = 0; i < Math.min(items.length, 5); i++) {
          const r = await ctx.container.content.process(items[i]!, lang, { skipDedup: true });
          if (r.ok && r.content) { result = r; break; }
        }
        if (result && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // Send the formatted post to admin PM (transformed via UX layer).
            try {
              const finalPost = await ctx.container.uxLayer.transform(result.content);
              await ctx.container.tg.sendMessage(ctx.adminId, finalPost.fullText, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
              }).catch(() => {});
            } catch { /* if transform fails, skip PM */ }
            await ctx.container.tg.sendMessage(ctx.adminId, [
              `📤 <b>Published from: ${arg}</b>`,
              `<b>AI:</b> ${result.content.aiProvider}/${result.content.aiModel}`,
              `<b>Quality:</b> ${result.content.quality.overallScore}`,
              `<b>Msg ID:</b> ${pubResult.telegramMessageId}`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ ${arg} published!`, redirectTo: "menu:main" };
          }
          return { alert: `❌ Publish failed: ${pubResult.error ?? "unknown"}` };
        }
        return { alert: `❌ All items rejected` };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  },
};

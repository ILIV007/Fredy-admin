/**
 * src/admin/screens/manual.ts
 * Manual Post screen — select category → select API → send post.
 * Posts are sent to BOTH the user's private chat AND the channel.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton, navButton } from "../keyboards";
import { header, divider } from "../helpers/formatting";
import type { Category } from "../../types/category";

export const manualScreen: Screen = {
  id: "manual",

  async text(ctx) {
    const data = ctx.query.data ?? "";
    if (data.startsWith("manual:cat:")) {
      const cat = data.split(":")[2] as Category;
      return this.showApisText(ctx, cat);
    }

    const sources = ctx.container.plugins.list();
    const cats: Category[] = ["A", "B", "C"];
    const lines = [
      header("Manual Post", "✍️"),
      "",
      "Select a category to see available APIs:",
      "",
    ];
    for (const cat of cats) {
      const catSources = sources.filter((s) => s.getCategory() === cat);
      const enabled = catSources.filter((s) => ctx.container.plugins.isEnabled(s.metadata.id));
      lines.push(`<b>Category ${cat}</b> — ${enabled.length} APIs`);
      for (const s of enabled) {
        lines.push(`  • ${s.metadata.name}`);
      }
      lines.push("");
    }
    lines.push(divider(), "<i>Posts sent to both your chat and the channel.</i>");
    return lines.join("\n");
  },

  keyboard(settings: FredySettings): InlineKeyboard {
    void settings;
    return buildKeyboardWithBack([
      [labelButton("─── Select Category ───")],
      [
        navButton("🟢 Category A", "manual:cat:A"),
        navButton("🟡 Category B", "manual:cat:B"),
      ],
      [navButton("🟣 Category C", "manual:cat:C")],
      [labelButton("─── Or ───")],
      [navButton("🎲 Random Post", "manual:random")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    // Random post
    if (data === "manual:random") {
      const sources = ctx.container.plugins.list().filter((s) => ctx.container.plugins.isEnabled(s.metadata.id));
      if (sources.length === 0) return { alert: "❌ No enabled APIs" };
      const random = sources[Math.floor(Math.random() * sources.length)]!;
      return this.sendPost(ctx, random.metadata.id);
    }

    // Category selection → show APIs
    if (data.startsWith("manual:cat:")) {
      const cat = data.split(":")[2] as Category;
      const sources = ctx.container.plugins.list()
        .filter((s) => s.getCategory() === cat)
        .filter((s) => ctx.container.plugins.isEnabled(s.metadata.id));

      const rows: InlineKeyboard["inline_keyboard"] = sources.map((s) => [
        { text: `📤 ${s.metadata.name}`, callback_data: `manual:send:${s.metadata.id}` },
      ]);
      rows.push([{ text: "← Back", callback_data: "menu:manual" }]);

      return {
        newText: `${header("Category " + cat + " APIs", "📡")}\n\nSelect an API to send:\n\n${sources.map((s) => `  • ${s.metadata.name}`).join("\n")}`,
        newKeyboard: { inline_keyboard: rows },
      };
    }

    // API selection → send post
    if (data.startsWith("manual:send:")) {
      const pluginId = data.split(":")[2]!;
      return this.sendPost(ctx, pluginId);
    }
  },

  async showApisText(ctx: ScreenContext, cat: Category): Promise<string> {
    const sources = ctx.container.plugins.list()
      .filter((s) => s.getCategory() === cat)
      .filter((s) => ctx.container.plugins.isEnabled(s.metadata.id));
    return [
      header(`Category ${cat} APIs`, "📡"),
      "",
      "Select an API to send:",
      "",
      ...sources.map((s) => `  • ${s.metadata.name} (${s.metadata.id})`),
    ].join("\n");
  },

  async sendPost(ctx: ScreenContext, pluginId: string): Promise<ScreenAction> {
    const { container, adminId, chatId } = ctx;
    try {
      // Step 1: Fetch
      let item;
      try {
        item = await container.plugins.fetchOne(pluginId);
      } catch (e) {
        return { alert: `❌ Fetch failed: ${e instanceof Error ? e.message.slice(0, 180) : String(e)}` };
      }
      if (!item) return { alert: `❌ No content from "${pluginId}"` };

      // Step 2: Pipeline (skip dedup for manual)
      const settings = await container.config.getSettings(adminId);
      let result;
      try {
        result = await container.content.process(item, settings.language.default, true);
      } catch (e) {
        return { alert: `❌ Pipeline error: ${e instanceof Error ? e.message.slice(0, 180) : String(e)}` };
      }
      if (!result.ok || !result.content) {
        return { alert: `❌ Pipeline: ${result.error ?? result.rejectedReason ?? "failed"} (${result.stage})` };
      }

      // Step 3: Preview to admin
      try {
        await container.tg.sendMessage(chatId,
          `<b>📝 Preview</b>\n\n${result.content.text.slice(0, 2000)}\n\n${result.content.sourceFooter}\n\n🌀 @ILIVIR3`,
          { parse_mode: "HTML", disable_web_page_preview: true }
        );
      } catch { /* continue */ }

      // Step 4: Publish to channel
      let pubResult;
      try {
        pubResult = await container.finalPublisher.publish(result.content);
      } catch (e) {
        return { toast: `⚠️ Preview sent, publish failed: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` };
      }
      return pubResult.ok
        ? { toast: `✅ Sent to chat + ${settings.telegram.targetChannel}!` }
        : { toast: `⚠️ Preview sent, channel failed: ${pubResult.error ?? "unknown"}` };
    } catch (e) {
      return { alert: `❌ ${e instanceof Error ? e.message.slice(0, 180) : String(e)}` };
    }
  },
};

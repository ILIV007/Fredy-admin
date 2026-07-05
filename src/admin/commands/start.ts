/**
 * src/admin/commands/start.ts
 * /start command — shows a full bot introduction + opens the admin menu.
 *
 * All users can see the introduction. Only the admin gets the inline menu.
 */

import type { Command, CommandContext } from "../registry";
import { mainScreen } from "../screens/main";
import type { FredySettings } from "../../types/config";

export const startCommand: Command = {
  name: "/start",
  description: "Show bot introduction and open admin menu",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, chatId, reply } = ctx;

    // 1. Send the introduction message (visible to everyone).
    await container.tg.sendMessage(chatId, buildIntroduction(), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }).catch(() => {});

    // 2. Send the admin menu (inline keyboard).
    const settings = await container.config.getSettings(adminId);
    const screenCtx = {
      container,
      adminId,
      chatId,
      messageId: 0,
      settings,
      query: {} as never,
    };
    const text = await mainScreen.text(screenCtx);
    const keyboard = mainScreen.keyboard(settings as FredySettings);

    await container.tg.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch(() => {});

    void reply;
  },
};

/** Build the full bot introduction message. */
function buildIntroduction(): string {
  return [
    "🤖 <b>Fredy — AI Content Engine</b>",
    "",
    "Fredy is an AI-powered content operating system that automatically collects, processes, and publishes high-quality developer content to the <b>ILIVIR3</b> channel.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🧠 <b>What Fredy Does</b>",
    "",
    "  📡 Collects content from 12 sources",
    "  🤖 Generates posts with AI (Gemini + OpenRouter)",
    "  🎯 Scores quality (0-100, minimum 60 to publish)",
    "  📅 Publishes on a smart schedule (4 posts/day)",
    "  🖼️ Attaches media automatically",
    "  🪝 Adds dynamic engagement hooks",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "📡 <b>Content Sources</b>",
    "",
    "  <b>Category A</b> — Developer Content",
    "    GitHub · Dev.to · StackExchange · Reddit · GitHub Releases",
    "",
    "  <b>Category B</b> — Tech News",
    "    NewsAPI · Hacker News",
    "",
    "  <b>Category C</b> — Support Content",
    "    NASA APOD · JokeAPI · XKCD · GitHub Trending · Wikimedia",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "⚙️ <b>Key Features</b>",
    "",
    "  ✅ Plugin-based architecture (add new sources easily)",
    "  ✅ Multi-model AI race with automatic fallback",
    "  ✅ 6-dimension quality scoring engine",
    "  ✅ Smart scheduler with random posting times",
    "  ✅ Humanized post formatting with hooks",
    "  ✅ Media resolver (no AI images, only real images)",
    "  ✅ Duplicate detection (URL + hash + title)",
    "  ✅ 28 auto-tags system",
    "  ✅ Admin-only Telegram control panel",
    "  ✅ Real-time debug dashboard",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🔧 <b>Tech Stack</b>",
    "",
    "  Cloudflare Workers (serverless, free tier)",
    "  TypeScript (strict mode)",
    "  KV Storage · Telegram Bot API",
    "  Google Gemini · OpenRouter (free AI models)",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "💎 <b>Cost</b>",
    "",
    "  $0/month — runs entirely on free tiers",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "👇 <b>Tap the buttons below to control Fredy.</b>",
    "",
    "<i>Only the admin can use these controls.</i>",
  ].join("\n");
}

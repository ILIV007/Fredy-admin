/**
 * src/admin/commands/start.ts
 * /start — shows bot introduction only (no menu).
 * /menu — opens admin dashboard.
 */

import type { Command, CommandContext } from "../registry";

export const startCommand: Command = {
  name: "/start",
  description: "Show bot introduction",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, chatId } = ctx;
    await container.tg.sendMessage(chatId, buildIntroduction(), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }).catch(() => {});
  },
};

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
    "  📅 Publishes on a smart schedule",
    "  🖼️ Attaches media automatically",
    "  🪝 Adds dynamic engagement hooks",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "📡 <b>Content Sources</b>",
    "",
    "  <b>Category A</b> — GitHub · Dev.to · StackExchange · Reddit · GitHub Releases",
    "  <b>Category B</b> — NewsAPI · Hacker News",
    "  <b>Category C</b> — NASA · JokeAPI · XKCD · GitHub Trending · Wikimedia",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "⚙️ <b>Key Features</b>",
    "",
    "  ✅ Plugin-based architecture",
    "  ✅ Multi-model AI with fallback",
    "  ✅ 6-dimension quality scoring",
    "  ✅ Smart scheduler with random posting",
    "  ✅ Humanized formatting with hooks",
    "  ✅ Media resolver (real images only)",
    "  ✅ Duplicate detection",
    "  ✅ Admin-only Telegram control panel",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🔧 <b>Tech Stack</b>",
    "",
    "  Cloudflare Workers · TypeScript · KV Storage",
    "  Google Gemini · OpenRouter (free AI models)",
    "",
    "💎 <b>Cost</b>: $0/month — fully on free tiers",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "👉 <b>Use /menu to open the admin dashboard.</b>",
    "",
    "<i>Only the admin can use these controls.</i>",
  ].join("\n");
}

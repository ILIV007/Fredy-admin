/**
 * src/admin/commands/help.ts
 * /help command — lists all available commands.
 *
 * v7.4.0: Updated to mention the new Strategy screen, Scheduler screen with
 * post history, and the Manager URL button.
 */

import type { Command, CommandContext } from "../registry";

export const helpCommand: Command = {
  name: "/help",
  description: "Show available commands",

  async handle(ctx: CommandContext): Promise<void> {
    const lines = [
      "<b>🤖 Fredy — Commands</b>",
      "",
      "<b>Admin Panel (main menu):</b>",
      "  /start — Open dashboard",
      "  /menu — Open dashboard (alias)",
      "  /help — This message",
      "",
      "<b>Dashboard Buttons:</b>",
      "  🎯 <b>Strategy</b> — Switch publishing mode (Minimal/Balanced/Active/AI Priority/News Priority/Custom)",
      "  📅 <b>Scheduler</b> — View today's slots + last 5 published posts, force tick",
      "  📚 <b>Categories</b> — Enable/disable A/B/C content categories",
      "  🔌 <b>Providers</b> — Toggle plugins + AI providers, run manual tests",
      "  🤖 <b>AI</b> — AI settings (provider, models, temperature, threshold)",
      "  ✍️ <b>Manual Post</b> — Trigger immediate post by category or source",
      "  ⚙️ <b>Settings</b> — General, language, content, quality settings",
      "  🎨 <b>Editor</b> — Soul.md editor",
      "  🖥️ <b>Manager</b> — Open the Manager dashboard (web) at",
      "       https://fredy-admin.iliv007-34b.workers.dev/Manager",
      "  🐛 <b>Debug</b> — Debug info and tools",
      "",
      "<b>Other Commands:</b>",
      "  /stats — Show statistics",
      "  /soul — View soul.md status",
      "  /checkperms — Check bot permissions in channel",
      "  /health — System health check",
      "",
      "<b>Tip:</b> Most actions are available from the dashboard buttons.",
      "<b>Tip:</b> The 🖥️ Manager button opens the full web dashboard where you can see the Queue, logs, and detailed config.",
    ];
    await ctx.reply(lines.join("\n"));
  },
};

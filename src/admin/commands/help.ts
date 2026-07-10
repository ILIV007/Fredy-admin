/**
 * src/admin/commands/help.ts
 * /help command — lists all available commands.
 */

import type { Command, CommandContext } from "../registry";

export const helpCommand: Command = {
  name: "/help",
  description: "Show available commands",

  async handle(ctx: CommandContext): Promise<void> {
    const lines = [
      "<b>🤖 Fredy — Commands</b>",
      "",
      "<b>Admin Panel:</b>",
      "  /start — Open dashboard",
      "  /help — This message",
      "  /stats — Show statistics",
      "  /soul — View soul.md status",
      "",
      "<b>Diagnostics:</b>",
      "  /checkperms — Check bot permissions in channel",
      "  /health — System health check",
      "",
      "<b>Tap any button in the dashboard to navigate.</b>",
    ];
    await ctx.reply(lines.join("\n"));
  },
};

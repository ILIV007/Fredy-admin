/**
 * src/admin/commands/help.ts
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
      "  /start — Show bot introduction",
      "  /menu — Open admin dashboard",
      "  /help — This message",
      "  /stats — Show statistics",
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

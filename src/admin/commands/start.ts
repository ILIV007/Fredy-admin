/**
 * src/admin/commands/start.ts
 * /start command — opens the main admin panel (dashboard).
 */

import type { Command, CommandContext } from "../registry";
import { mainScreen } from "../screens/main";

export const startCommand: Command = {
  name: "/start",
  description: "Welcome message and open admin panel",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, chatId } = ctx;
    const settings = await container.config.getSettings(adminId);
    const screenCtx = {
      container,
      adminId,
      chatId,
      messageId: 0,
      settings,
      query: {} as never,
    };
    // Send welcome message first
    await container.tg.sendMessage(chatId, [
      "👋 <b>Welcome to Fredy!</b>",
      "",
      "Fredy is an AI-powered content engine for the ILIVIR3 Telegram channel.",
      "",
      "<b>Quick commands:</b>",
      "• <code>/menu</code> — Open admin dashboard",
      "• <code>/help</code> — Show all commands",
      "• <code>/stats</code> — View statistics",
      "• <code>/health</code> — System health check",
      "",
      "<i>Opening dashboard...</i>",
    ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
    // Then send the dashboard
    const text = await mainScreen.text(screenCtx);
    const keyboard = mainScreen.keyboard(settings, screenCtx);
    await container.tg.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch((e: unknown) => {
      console.error("[start] sendMessage failed:", e);
    });
    void ctx.reply;
  },
};

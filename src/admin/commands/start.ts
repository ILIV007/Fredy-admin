/**
 * src/admin/commands/start.ts
 * /start command — opens the main admin panel (dashboard).
 */

import type { Command, CommandContext } from "../registry";
import { mainScreen } from "../screens/main";

export const startCommand: Command = {
  name: "/start",
  description: "Open the admin panel (dashboard)",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, chatId } = ctx;
    console.log("[start] handle called");
    const settings = await container.config.getSettings(adminId);
    const screenCtx = {
      container,
      adminId,
      chatId,
      messageId: 0,
      settings,
      query: {} as never,
    };
    console.log("[start] building text...");
    const text = await mainScreen.text(screenCtx);
    console.log("[start] building keyboard...");
    const keyboard = mainScreen.keyboard(settings);
    console.log("[start] sending message...");
    await container.tg.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch((e: unknown) => {
      console.error("[start] sendMessage failed:", e);
    });
    console.log("[start] done");
    void ctx.reply;
  },
};

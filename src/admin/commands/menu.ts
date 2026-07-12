/**
 * src/admin/commands/menu.ts
 * /menu — opens the admin dashboard with inline keyboard.
 */

import type { Command, CommandContext } from "../registry";
import { mainScreen } from "../screens/main";

export const menuCommand: Command = {
  name: "/menu",
  description: "Open admin dashboard",

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
    const text = await mainScreen.text(screenCtx);
    const keyboard = mainScreen.keyboard(settings);
    await container.tg.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch(() => {});
  },
};

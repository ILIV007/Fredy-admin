/**
 * src/admin/commands/menu.ts
 * /menu command — opens the admin dashboard with inline keyboard.
 */

import type { Command, CommandContext } from "../registry";
import { mainScreen } from "../screens/main";
import type { FredySettings } from "../../types/config";

export const menuCommand: Command = {
  name: "/menu",
  description: "Open the admin menu",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, chatId } = ctx;
    console.log("[menu] handle called");
    const settings = await container.config.getSettings(adminId);
    const screenCtx = {
      container,
      adminId,
      chatId,
      messageId: 0,
      settings,
      query: {} as never,
    };
    console.log("[menu] building text...");
    const text = await mainScreen.text(screenCtx);
    console.log("[menu] building keyboard...");
    const keyboard = mainScreen.keyboard(settings as FredySettings);
    console.log("[menu] sending message...");
    await container.tg.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch((e: unknown) => {
      console.error("[menu] sendMessage failed:", e);
    });
    console.log("[menu] done");
  },
};

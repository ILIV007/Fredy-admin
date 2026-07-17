/**
 * src/admin/commands/start.ts
 * /start command — opens the main admin panel (dashboard).
 * v7.4.3: Persian welcome message with blockquote UI.
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
    // Send welcome message first — Persian with blockquote UI.
    await container.tg.sendMessage(chatId, [
      `👋 <b>به فردی خوش آمدید!</b>`,
      ``,
      `<blockquote>🤖 فردی یک موتور محتوای هوش مصنوعی برای کانال تلگرام ILIVIR3 است.</blockquote>`,
      ``,
      `<blockquote><b>📋 دستورات سریع:</b></blockquote>`,
      `• <code>/menu</code> — باز کردن داشبورد مدیریت`,
      `• <code>/help</code> — نمایش همه دستورات`,
      `• <code>/stats</code> — مشاهده آمار`,
      `• <code>/health</code> — بررسی سلامت سیستم`,
      ``,
      `<blockquote>⏳ <i>در حال باز کردن داشبورد...</i></blockquote>`,
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

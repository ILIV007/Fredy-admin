/**
 * src/admin/commands/start.ts
 * /start command — shows overview + help, with an inline Language button.
 *
 * v7.4.5: The Language button on /start controls the BOT UI language
 * (how admin messages are displayed), NOT the post content language.
 * The post content language is set via main menu → Post Language.
 *
 * Default bot UI language: English.
 */

import type { Command, CommandContext } from "../registry";
import type { InlineKeyboard, InlineKeyboardButton } from "../../types/telegram";
import type { KVStore } from "../../services/kv-store";

/** Available bot UI languages. */
export const BOT_UI_LANGUAGES = ["en", "fa"] as const;
export type BotUiLanguage = (typeof BOT_UI_LANGUAGES)[number];

/** KV key for the admin's chosen bot UI language. */
const BOT_UI_LANG_KEY = (adminId: number) => `fredy:botui:${adminId}`;

/** Get the admin's bot UI language (default: en). */
export async function getBotUiLanguage(adminId: number, kv: KVStore): Promise<BotUiLanguage> {
  const v = await kv.get(BOT_UI_LANG_KEY(adminId));
  if (v === "fa" || v === "en") return v;
  return "en";
}

/** Set the admin's bot UI language. */
export async function setBotUiLanguage(adminId: number, kv: KVStore, lang: BotUiLanguage): Promise<void> {
  await kv.set(BOT_UI_LANG_KEY(adminId), lang);
}

export const startCommand: Command = {
  name: "/start",
  description: "Welcome message with Language inline button",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, chatId } = ctx;
    const curLang = await getBotUiLanguage(adminId, container.kv);

    const lines = buildWelcomeMessage(curLang);

    // Inline keyboard with Language button + Open Dashboard.
    const buttons: InlineKeyboardButton[][] = [
      [
        { text: curLang === "en" ? "🟢 English" : "English", callback_data: "botui:set:en" },
        { text: curLang === "fa" ? "🟢 فارسی" : "فارسی", callback_data: "botui:set:fa" },
      ],
      [
        { text: curLang === "fa" ? "📋 باز کردن داشبورد" : "📋 Open Dashboard", callback_data: "menu:main" },
      ],
    ];
    const keyboard: InlineKeyboard = { inline_keyboard: buttons };

    await container.tg.sendMessage(chatId, lines, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch((e: unknown) => {
      console.error("[start] sendMessage failed:", e);
    });
    void ctx.reply;
  },
};

/** Build the welcome message — localized based on bot UI language. */
export function buildWelcomeMessage(lang: BotUiLanguage): string {
  if (lang === "fa") {
    return [
      `👋 <b>به فردی خوش آمدید!</b>`,
      ``,
      `<blockquote>🤖 <b>فردی</b> یک موتور محتوای هوش مصنوعی برای کانال تلگرام ILIVIR3 است.</blockquote>`,
      `<blockquote>📡 محتوا را از ۱۲ پلاگین منبع دریافت می‌کند (GitHub، Dev.to، HackerNews، NASA، NewsAPI و غیره)</blockquote>`,
      `<blockquote>🧠 آن‌ها را از طریق هوش مصنوعی Gemini/OpenRouter بازنویسی می‌کند</blockquote>`,
      `<blockquote>📅 با کنترل کیفیت در یک زمان‌بندی قابل تنظیم منتشر می‌کند</blockquote>`,
      ``,
      `<b>📋 دستورات سریع:</b>`,
      `  • <code>/menu</code> — باز کردن داشبورد مدیریت`,
      `  • <code>/help</code> — نمایش همه دستورات`,
      `  • <code>/stats</code> — مشاهده آمار`,
      `  • <code>/health</code> — بررسی سلامت سیستم`,
      ``,
      `<blockquote>💡 <i>برای تغییر زبان ربات، دکمه زیر را بزنید.</i></blockquote>`,
    ].join("\n");
  }
  return [
    `👋 <b>Welcome to Fredy!</b>`,
    ``,
    `<blockquote>🤖 <b>Fredy</b> is an AI-powered content engine for the ILIVIR3 Telegram channel.</blockquote>`,
    `<blockquote>📡 It fetches content from 12 source plugins (GitHub, Dev.to, HackerNews, NASA, NewsAPI, etc.)</blockquote>`,
    `<blockquote>🧠 Processes them through Gemini/OpenRouter AI for rewriting</blockquote>`,
    `<blockquote>📅 Publishes on a configurable schedule with quality control</blockquote>`,
    ``,
    `<b>📋 Quick Commands:</b>`,
    `  • <code>/menu</code> — Open admin dashboard`,
    `  • <code>/help</code> — Show all commands`,
    `  • <code>/stats</code> — View statistics`,
    `  • <code>/health</code> — System health check`,
    ``,
    `<blockquote>💡 <i>Tap a button below to change the bot UI language.</i></blockquote>`,
  ].join("\n");
}

/**
 * src/admin/commands/start.ts
 * /start command — shows a brief welcome with a Language inline button.
 *
 * v8.3.0: /start now shows a SEPARATE welcome message with:
 *   - Bot overview (what it does)
 *   - Quick commands (/menu, /help, /stats, /health)
 *   - 🌐 Language button (opens language selection in a new message)
 *   - 📋 Open Dashboard button (goes to main menu)
 *
 * The main dashboard is NOT shown on /start — it's accessible via
 * /menu or the "📋 Open Dashboard" button.
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

/** Get the display name for a language. */
export function langDisplayName(lang: BotUiLanguage): string {
  return lang === "fa" ? "فارسی" : "English";
}

export const startCommand: Command = {
  name: "/start",
  description: "Welcome message with Language button",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, chatId } = ctx;
    const curLang = await getBotUiLanguage(adminId, container.kv);

    // v11.4.0: Register command menu with Telegram (so commands appear in "/" autocomplete).
    // This is idempotent — safe to call on every /start.
    void container.tg.registerCommands().catch(() => {});

    const lines = buildWelcomeMessage(curLang);

    // Single Language button + Open Dashboard button.
    const buttons: InlineKeyboardButton[][] = [
      [
        { text: `🌐 Language: ${langDisplayName(curLang)}`, callback_data: "botui:open" },
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
      `<blockquote>🤖 <b>فردی v11.4</b> — موتور محتوای هوشمند برای کانال ILIVIR3</blockquote>`,
      `<blockquote>📡 ۲۰ پلاگین منبع در ۴ Tier (S/A/B/Legacy)</blockquote>`,
      `<blockquote>🧠 بازنویسی با Gemini/OpenRouter AI</blockquote>`,
      `<blockquote>📅 زمان‌بندی هوشمند با کنترل کیفیت</blockquote>`,
      `<blockquote>🔬 سیستم Debug کامل Scheduler</blockquote>`,
      ``,
      `<b>📋 دستورات (در منوی /):</b>`,
      `  • <code>/menu</code> — داشبورد مدیریت`,
      `  • <code>/tiers</code> — مشاهده پلاگین‌ها بر اساس Tier`,
      `  • <code>/plan</code> — برنامه انتشار امروز`,
      `  • <code>/debug</code> — Debug Scheduler`,
      `  • <code>/providers</code> — سلامت پلاگین‌ها`,
      `  • <code>/force</code> — انتشار فوری یک پست`,
      `  • <code>/stats</code> — آمار`,
      `  • <code>/health</code> — سلامت سیستم`,
      `  • <code>/help</code> — راهنمای کامل`,
    ].join("\n");
  }
  return [
    `👋 <b>Welcome to Fredy!</b>`,
    ``,
    `<blockquote>🤖 <b>Fredy v11.4</b> — AI-powered content engine for ILIVIR3</blockquote>`,
    `<blockquote>📡 20 source plugins across 4 tiers (S/A/B/Legacy)</blockquote>`,
    `<blockquote>🧠 AI rewriting via Gemini/OpenRouter</blockquote>`,
    `<blockquote>📅 Smart scheduling with quality control</blockquote>`,
    `<blockquote>🔬 Full scheduler debug system</blockquote>`,
    ``,
    `<b>📋 Commands (in / menu):</b>`,
    `  • <code>/menu</code> — Admin dashboard`,
    `  • <code>/tiers</code> — View providers by tier`,
    `  • <code>/plan</code> — Today's publishing plan`,
    `  • <code>/debug</code> — Scheduler debug`,
    `  • <code>/providers</code> — Provider health`,
    `  • <code>/force</code> — Force publish one post`,
    `  • <code>/stats</code> — Statistics`,
    `  • <code>/health</code> — System health`,
    `  • <code>/help</code> — Full help`,
  ].join("\n");
}

/** Build the language selection message (shown when "🌐 Language" is tapped). */
export function buildLanguageSelectionMessage(lang: BotUiLanguage): string {
  if (lang === "fa") {
    return [
      `🌐 <b>انتخاب زبان ربات</b>`,
      ``,
      `<blockquote>زبان فعلی: <b>${langDisplayName(lang)}</b></blockquote>`,
      `<blockquote>این زبان نحوه نمایش پیام‌های ربات به ادمین را کنترل می‌کند.</blockquote>`,
      `<blockquote>⚠️ این زبان، زبان محتوای پست‌ها نیست. زبان پست‌ها از منوی اصلی ← Post Language تنظیم می‌شود.</blockquote>`,
      ``,
      `<i>برای انتخاب، روی یکی از گزینه‌های زیر بزنید:</i>`,
    ].join("\n");
  }
  return [
    `🌐 <b>Bot Language Selection</b>`,
    ``,
    `<blockquote>Current language: <b>${langDisplayName(lang)}</b></blockquote>`,
    `<blockquote>This controls how admin messages from the bot are displayed.</blockquote>`,
    `<blockquote>⚠️ This is NOT the post content language. Post language is set via Main Menu ← Post Language.</blockquote>`,
    ``,
    `<i>Tap one of the options below to select:</i>`,
  ].join("\n");
}

/** Build the language selection keyboard. */
export function buildLanguageKeyboard(cur: BotUiLanguage): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: cur === "en" ? "🟢 English ✓" : "English", callback_data: "botui:set:en" },
        { text: cur === "fa" ? "🟢 فارسی ✓" : "فارسی", callback_data: "botui:set:fa" },
      ],
      [
        { text: cur === "fa" ? "↩️ بازگشت" : "↩️ Back", callback_data: "botui:back" },
      ],
    ],
  };
}

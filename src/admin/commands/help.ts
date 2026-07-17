/**
 * src/admin/commands/help.ts
 * /help command — lists all available commands in Persian.
 */

import type { Command, CommandContext } from "../registry";

export const helpCommand: Command = {
  name: "/help",
  description: "Show available commands",

  async handle(ctx: CommandContext): Promise<void> {
    const lines = [
      `<b>🤖 فردی — راهنمای دستورات</b>`,
      ``,
      `<blockquote><b>📋 پنل مدیریت (منوی اصلی):</b></blockquote>`,
      `  <code>/start</code> — باز کردن داشبورد`,
      `  <code>/menu</code> — باز کردن داشبورد (مستقیم)`,
      `  <code>/help</code> — نمایش این پیام`,
      ``,
      `<blockquote><b>🎛️ دکمه‌های داشبورد:</b></blockquote>`,
      `  🎯 <b>استراتژی</b> — تغییر حالت انتشار (حداقل/متعادل/فعال/اولویت AI/اولویت خبر/سفارشی)`,
      `  📅 <b>زمان‌بند</b> — مشاهده زمان‌بندی امروز + ۵ پست اخیر + انتشار فوری`,
      `  📚 <b>دسته‌بندی‌ها</b> — فعال/غیرفعال کردن دسته‌های A/B/C`,
      `  🔌 <b>پروایدرها</b> — فعال/غیرفعال کردن پلاگین‌ها + AI، تست دستی`,
      `  🤖 <b>هوش مصنوعی</b> — تنظیمات AI (پروایدر، مدل‌ها، دما، آستانه)`,
      `  ✍️ <b>ارسال دستی</b> — انتشار فوری پست بر اساس دسته یا منبع`,
      `  ⚙️ <b>تنظیمات</b> — عمومی، زبان، محتوا، کیفیت`,
      `  🎨 <b>ویرایشگر</b> — ویرایشگر Soul.md`,
      `  🖥️ <b>منیجر</b> — باز کردن داشبورد وب منیجر`,
      `  🐛 <b>دیباگ</b> — اطلاعات و ابزارهای دیباگ`,
      ``,
      `<blockquote><b>📝 دستورات دیگر:</b></blockquote>`,
      `  <code>/stats</code> — نمایش آمار`,
      `  <code>/soul</code> — مشاهده وضعیت Soul.md`,
      `  <code>/checkperms</code> — بررسی دسترسی‌های ربات در کانال`,
      `  <code>/health</code> — بررسی سلامت سیستم`,
      ``,
      `<blockquote>💡 <i>بیشتر عملیات از دکمه‌های داشبورد در دسترس است.</i></blockquote>`,
      `<blockquote>💡 <i>دکمه 🖥️ منیجر داشبورد کامل وب را باز می‌کند که صف، لاگ‌ها و تنظیمات دقیق را می‌بینید.</i></blockquote>`,
    ];
    await ctx.reply(lines.join("\n"));
  },
};

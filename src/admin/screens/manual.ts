/**
 * src/admin/screens/manual.ts
 * Manual Actions screen — send category A/B/C, send NASA, send specific plugin.
 *
 * Triggers immediate pipeline runs without waiting for the scheduler.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import type { Category } from "../../types/category";
import { buildKeyboardWithBack, labelButton, navButton } from "../keyboards";
import { header, divider, kv } from "../helpers/formatting";

export const manualScreen: Screen = {
  id: "manual",

  async text(ctx) {
    const plugins = ctx.container.plugins.list();
    return [
      header("Manual Actions", "✍️"),
      "",
      "Trigger an immediate post. The pipeline runs once and publishes to the channel.",
      "",
      header("By Category", "📚"),
      kv("A", "Dev content (programming, AI, GitHub, tools)"),
      kv("B", "Tech news"),
      kv("C", "NASA / joke / quote / fact"),
      "",
      header("By Source", "🔌"),
      ...plugins.map((p) => kv(p.metadata.name, `${p.metadata.id} (${p.metadata.category})`)),
      "",
      divider(),
      "<i>Tap an action to run it now.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    void s;
    return buildKeyboardWithBack([
      [labelButton("─── By Category ───")],
      [navButton("🟢 Send Category A", "action:manual:category:A")],
      [navButton("🟡 Send Category B", "action:manual:category:B")],
      [navButton("🟣 Send Category C", "action:manual:category:C")],
      [labelButton("─── By Source ───")],
      [navButton("📦 GitHub", "action:manual:source:github")],
      [navButton("🚀 GitHub Trending", "action:manual:source:github-trending")],
      [navButton("🏷️ GitHub Releases", "action:manual:source:github-releases")],
      [navButton("🛠️ Dev.to", "action:manual:source:devto")],
      [navButton("📚 Stack Exchange", "action:manual:source:stackexchange")],
      [navButton("📰 News", "action:manual:source:news")],
      [navButton("🔥 Hacker News", "action:manual:source:hackernews")],
      [navButton("🪐 NASA", "action:manual:source:nasa")],
      [navButton("😄 Joke", "action:manual:source:joke")],
      [navButton("🎨 XKCD", "action:manual:source:xkcd")],
      [navButton("📜 Wikimedia", "action:manual:source:wikimedia")],
      [labelButton("─── Special ───")],
      [navButton("🧪 Simulate (no publish)", "action:manual:simulate")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: action:manual:<type>:<arg>
    if (parts.length < 3 || parts[0] !== "action" || parts[1] !== "manual") return;
    const type = parts[2] ?? "";
    const arg = parts[3] ?? "";

    if (type === "simulate") {
      return { toast: "🧪 Simulation not implemented yet" };
    }

    if (type === "category") {
      if (!["A", "B", "C"].includes(arg)) {
        return { alert: "❌ Invalid category" };
      }
      try {
        const settings = await ctx.container.config.getSettings(ctx.adminId);
        const lang = settings?.language?.default ?? "auto";
        // v7.4.2: skipEnqueue=true — manual posts should NOT also go to the queue.
        const result = await ctx.container.content.processForCategory(
          arg as Category,
          null,
          lang,
          { skipEnqueue: true },
        );
        if (result.ok && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // Send the EXACT same formatted post to admin PM as what went to channel.
            try {
              const finalPost = await ctx.container.uxLayer.transform(result.content);
              if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
                await ctx.container.tg.sendPhoto(ctx.adminId, finalPost.media.url, finalPost.caption, {
                  parse_mode: "HTML",
                }).catch(() => {});
              } else {
                await ctx.container.tg.sendMessage(ctx.adminId, finalPost.fullText, {
                  parse_mode: "HTML",
                }).catch(() => {});
              }
            } catch { /* if transform fails, skip PM */ }
            await ctx.container.tg.sendMessage(ctx.adminId, [
              `📤 <b>پست از دسته ${arg} منتشر شد</b>`,
              `<blockquote>🤖 <b>هوش مصنوعی:</b> ${result.content.aiProvider}/${result.content.aiModel}</blockquote>`,
              `<blockquote>🎯 <b>کیفیت:</b> ${result.content.quality.overallScore}</blockquote>`,
              `<blockquote>📤 <b>شناسه پیام:</b> ${pubResult.telegramMessageId}</blockquote>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ دسته ${arg} منتشر شد!`, redirectTo: "menu:main" };
          }
          return { alert: `❌ انتشار ناموفق: ${pubResult.error ?? "نامشخص"}` };
        }
        return { alert: `❌ محتوایی برای دسته ${arg} یافت نشد` };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (type === "source") {
      if (!arg) {
        return { alert: "❌ شناسه منبع مشخص نشده" };
      }
      try {
        const items = await ctx.container.plugins.fetchFrom(arg);
        if (items.length === 0) {
          return { alert: `❌ آیتمی از ${arg} یافت نشد` };
        }
        const settings = await ctx.container.config.getSettings(ctx.adminId);
        const lang = settings?.language?.default ?? "auto";
        // Try up to 5 items until one passes.
        // NOTE: dedup is now always checked (skipDedup=false). When the
        // first item is a duplicate, the result carries `duplicateOf`
        // and we route the post to admin PM with a "duplicate" notice
        // instead of publishing to the channel.
        let result = null;
        let firstDuplicate: { itemId: string; existingId: string; reason: string; item: typeof items[number] } | null = null;
        for (let i = 0; i < Math.min(items.length, 5); i++) {
          // v7.4.2: skipEnqueue=true — manual posts should NOT also go to the queue.
          const r = await ctx.container.content.process(items[i]!, lang, { skipDedup: false, skipEnqueue: true });
          if (r.ok && r.content) { result = r; break; }
          if (!firstDuplicate && r.duplicateOf) {
            firstDuplicate = {
              itemId: items[i]!.id,
              existingId: r.duplicateOf.contentId,
              reason: r.duplicateOf.reason,
              item: items[i]!,
            };
          }
        }

        // ── Duplicate fallback: send FORMATTED POST + duplicate notice to admin PM ──
        // The user wants: if a manually-triggered post would be a duplicate,
        // do NOT publish to channel. Instead, send the FORMATTED POST itself
        // (so admin can just forward it) followed by a duplicate notice.
        // The previous /force_url command never worked.
        if (!result && firstDuplicate) {
          const dupItem = firstDuplicate.item;
          // 1. Re-process with skipDedup=true so the AI pipeline runs and
          //    we get a full ReadyContent we can format.
          try {
            const dupProcessed = await ctx.container.content.process(dupItem, lang, { skipDedup: true, skipEnqueue: true });
            if (dupProcessed.ok && dupProcessed.content) {
              const finalPost = await ctx.container.uxLayer.transform(dupProcessed.content);
              // Send the formatted post (photo or text).
              if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
                await ctx.container.tg.sendPhoto(ctx.adminId, finalPost.media.url, finalPost.caption, {
                  parse_mode: "HTML",
                }).catch(() => {});
              } else {
                await ctx.container.tg.sendMessage(ctx.adminId, finalPost.fullText, {
                  parse_mode: "HTML",
                }).catch(() => {});
              }
            }
          } catch { /* transform failed — fall through to notice */ }

          // 2. Send the duplicate notice.
          try {
            await ctx.container.tg.sendMessage(ctx.adminId, [
              `🔁 <b>Duplicate detected (not published to channel)</b>`,
              ``,
              `<b>Source:</b> ${arg}`,
              `<b>Item:</b> ${dupItem.title?.slice(0, 200) ?? "(no title)"}`,
              `<b>URL:</b> ${dupItem.url ?? "(no url)"}`,
              `<b>Matches existing:</b> <code>${firstDuplicate.existingId}</code> (${firstDuplicate.reason})`,
              ``,
              `<i>The formatted post above was sent here for manual forwarding. Forward it to the channel if you want it published anyway.</i>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
          } catch { /* skip */ }
          return { toast: `🔁 ${arg}: duplicate — formatted post sent to PM for forwarding`, redirectTo: "menu:main" };
        }

        if (result && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // Send the EXACT same formatted post to admin PM as what went to channel.
            try {
              const finalPost = await ctx.container.uxLayer.transform(result.content);
              if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
                await ctx.container.tg.sendPhoto(ctx.adminId, finalPost.media.url, finalPost.caption, {
                  parse_mode: "HTML",
                }).catch(() => {});
              } else {
                await ctx.container.tg.sendMessage(ctx.adminId, finalPost.fullText, {
                  parse_mode: "HTML",
                }).catch(() => {});
              }
            } catch { /* if transform fails, skip PM */ }
            await ctx.container.tg.sendMessage(ctx.adminId, [
              `📤 <b>پست از منبع ${arg} منتشر شد</b>`,
              `<blockquote>🤖 <b>هوش مصنوعی:</b> ${result.content.aiProvider}/${result.content.aiModel}</blockquote>`,
              `<blockquote>🎯 <b>کیفیت:</b> ${result.content.quality.overallScore}</blockquote>`,
              `<blockquote>📤 <b>شناسه پیام:</b> ${pubResult.telegramMessageId}</blockquote>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ ${arg} منتشر شد!`, redirectTo: "menu:main" };
          }
          return { alert: `❌ انتشار ناموفق: ${pubResult.error ?? "نامشخص"}` };
        }
        return { alert: "❌ همه آیتم‌ها رد شدند" };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  },
};

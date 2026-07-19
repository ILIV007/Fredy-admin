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
import { reportBanner, reportRow, qualityRow } from "../../primitives/report";

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
    // v11.4.0: All 20 providers organized by tier.
    return buildKeyboardWithBack([
      [labelButton("─── By Category ───")],
      [
        navButton("🟢 Cat A", "action:manual:category:A"),
        navButton("🟡 Cat B", "action:manual:category:B"),
        navButton("🟣 Cat C", "action:manual:category:C"),
      ],
      [labelButton("─── Tier S (Core) ───")],
      [
        navButton("📦 GitHub", "action:manual:source:github"),
        navButton("🏷️ GH Releases", "action:manual:source:github-releases"),
      ],
      [
        navButton("🚀 GH Trending", "action:manual:source:github-trending"),
        navButton("⚡ GH Events", "action:manual:source:github-events"),
      ],
      [
        navButton("🛠️ Dev.to", "action:manual:source:devto"),
        navButton("🔥 HN Algolia", "action:manual:source:hackernews-algolia"),
      ],
      [navButton("🪐 NASA APOD", "action:manual:source:nasa")],
      [labelButton("─── Tier A (Important) ───")],
      [
        navButton("📚 StackExchange", "action:manual:source:stackexchange"),
        navButton("☁️ CF Blog", "action:manual:source:cloudflare-blog"),
      ],
      [
        navButton("🤗 HF Blog", "action:manual:source:huggingface-blog"),
        navButton("🏆 ProductHunt", "action:manual:source:producthunt"),
      ],
      [labelButton("─── Tier B (Supporting) ───")],
      [
        navButton("🎨 XKCD", "action:manual:source:xkcd"),
        navButton("🔒 GH Security", "action:manual:source:github-security"),
      ],
      [
        navButton("🤖 OpenAI News", "action:manual:source:openai-news"),
        navButton("👾 Reddit", "action:manual:source:reddit-v2"),
      ],
      [labelButton("─── Legacy ───")],
      [
        navButton("📰 News", "action:manual:source:news"),
        navButton("😄 Joke", "action:manual:source:joke"),
      ],
      [
        navButton("📜 Wikimedia", "action:manual:source:wikimedia"),
        navButton("🔥 HN (old)", "action:manual:source:hackernews"),
      ],
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
        // v8.0.0: typing indicator while the pipeline runs.
        const typingTimer = setInterval(() => {
          ctx.container.tg.sendChatAction(ctx.chatId, "typing").catch(() => {});
        }, 4000);
        try {
          // v8.0.0: Add skipEnqueue so manual triggers don't pollute the queue.
          const result = await ctx.container.content.processForCategory(
            arg as Category,
            null,
            lang,
            { skipEnqueue: true },
          );
        if (result.ok && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // v9.3.1: Record in dedup store ONLY after successful publish.
            await ctx.container.duplicateDetector.recordPublished(result.content).catch(() => {});
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
              ``,
              reportBanner("📤", `MANUAL PUBLISH — CATEGORY ${arg}`),
              ``,
              ``,
              reportRow("🏷️", "Category", result.content.category),
              reportRow("🔌", "Source Plugin", result.content.pluginId),
              reportRow("🤖", "AI Model", `${result.content.aiProvider}/${result.content.aiModel}`),
              qualityRow(result.content.quality.overallScore),
              reportRow("📊", "Tokens Used", String(result.content.tokensUsed)),
              reportRow("📤", "Channel Message ID", String(pubResult.telegramMessageId)),
              reportRow("🔖", "Content ID", result.content.id),
              reportRow("🔗", "Source URL", result.content.sourceUrl ?? "(none)"),
              reportRow("📰", "Headline", result.content.headline ?? "(none)"),
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ Category ${arg} published!`, redirectTo: "menu:main" };
          }
          return { alert: `❌ Publish failed: ${pubResult.error ?? "unknown"}` };
        }
        return { alert: `❌ No content for ${arg}` };
        } finally {
          clearInterval(typingTimer);
        }
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (type === "source") {
      if (!arg) {
        return { alert: "❌ Missing source ID" };
      }
      try {
        const items = await ctx.container.plugins.fetchFrom(arg);
        if (items.length === 0) {
          return { alert: `❌ No items from ${arg}` };
        }
        const settings = await ctx.container.config.getSettings(ctx.adminId);
        const lang = settings?.language?.default ?? "auto";
        // v8.0.0: typing indicator while the pipeline runs.
        const typingTimer = setInterval(() => {
          ctx.container.tg.sendChatAction(ctx.chatId, "typing").catch(() => {});
        }, 4000);
        try {
        // Try up to 5 items until one passes.
        // NOTE: dedup is now always checked (skipDedup=false). When the
        // first item is a duplicate, the result carries `duplicateOf`
        // and we route the post to admin PM with a "duplicate" notice
        // instead of publishing to the channel.
        let result = null;
        let firstDuplicate: { itemId: string; existingId: string; reason: string; item: typeof items[number] } | null = null;
        for (let i = 0; i < Math.min(items.length, 5); i++) {
          // v8.0.0: skipEnqueue so manual triggers don't pollute the queue.
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
              ``,
              reportBanner("🔁", "DUPLICATE DETECTED"),
              ``,
              ``,
              reportRow("🔌", "Source", arg),
              reportRow("📰", "Item", dupItem.title?.slice(0, 200) ?? "(no title)"),
              reportRow("🔗", "URL", dupItem.url ?? "(no url)"),
              reportRow("⚠️", "Matches existing", `${firstDuplicate.existingId} (${firstDuplicate.reason})`),
              ``,
              `<blockquote>💡 <i>The formatted post above was sent here for manual forwarding. Forward it to the channel if you want it published anyway.</i></blockquote>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
          } catch { /* skip */ }
          return { toast: `🔁 ${arg}: duplicate — formatted post sent to PM for forwarding`, redirectTo: "menu:main" };
        }

        if (result && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            // v9.3.1: Record in dedup store ONLY after successful publish.
            await ctx.container.duplicateDetector.recordPublished(result.content).catch(() => {});
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
              ``,
              reportBanner("📤", `MANUAL PUBLISH — ${arg}`),
              ``,
              ``,
              reportRow("🏷️", "Category", result.content.category),
              reportRow("🔌", "Source Plugin", result.content.pluginId),
              reportRow("🤖", "AI Model", `${result.content.aiProvider}/${result.content.aiModel}`),
              qualityRow(result.content.quality.overallScore),
              reportRow("📊", "Tokens Used", String(result.content.tokensUsed)),
              reportRow("📤", "Channel Message ID", String(pubResult.telegramMessageId)),
              reportRow("🔖", "Content ID", result.content.id),
              reportRow("🔗", "Source URL", result.content.sourceUrl ?? "(none)"),
              reportRow("📰", "Headline", result.content.headline ?? "(none)"),
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
            return { toast: `✅ ${arg} published!`, redirectTo: "menu:main" };
          }
          return { alert: `❌ Publish failed: ${pubResult.error ?? "unknown"}` };
        }
        return { alert: `❌ All items rejected` };
        } finally {
          clearInterval(typingTimer);
        }
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  },
};

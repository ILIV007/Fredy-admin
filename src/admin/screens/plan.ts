/**
 * src/admin/screens/plan.ts
 * v11.3.0: Daily Plan viewer screen.
 *
 * Shows today's publishing plan with slot statuses:
 *   - Pending / Published / Failed / Publishing / Backup
 *   - Time, category, provider
 *   - Overdue indicator for due slots
 *
 * Allows:
 *   - Fire a specific slot now
 *   - Regenerate the plan
 *   - View scheduler debug
 */

import type { Screen, ScreenAction } from "../registry";
import type { ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { escapeHtml } from "../../primitives/strings";
import { formatDateInZone } from "../../primitives/time";
import { buildKeyboard } from "../keyboards";

export const planScreen: Screen = {
  id: "plan",

  async text(ctx: ScreenContext): Promise<string> {
    try {
      const settings = await ctx.container.config.getSettings(Number(ctx.container.env.ADMIN_ID ?? "0"));
      const tz = settings.scheduler.timezone || "UTC";
      const today = formatDateInZone(Date.now(), tz);
      const now = Date.now();

      const plan = await ctx.container.strategyEngine.getOrGeneratePlan();

      const statusEmojis: Record<string, string> = {
        pending: "⏳",
        published: "✅",
        failed: "❌",
        publishing: "🔄",
        backup: "♻️",
        skipped: "⏭️",
      };

      let html = `<b>━━━ 📋 Daily Plan (${today}) ━━━</b>\n\n`;

      const completed = plan.posts.filter((p) => p.status === "published" || p.status === "backup").length;
      const failed = plan.posts.filter((p) => p.status === "failed").length;
      const pending = plan.posts.filter((p) => p.status === "pending").length;

      html += `<blockquote>📊 Total: ${plan.posts.length} | ✅ Done: ${completed} | ⏳ Pending: ${pending} | ❌ Failed: ${failed}</blockquote>\n`;
      html += `<blockquote>🎯 Strategy: ${plan.strategy} | 📅 Date: ${plan.date}</blockquote>\n\n`;

      html += `<b>#  Time  Cat  Provider     Status</b>\n`;
      for (const post of plan.posts) {
        const overdue = post.epochMs <= now && post.status === "pending"
          ? ` (${Math.round((now - post.epochMs) / 60000)}m overdue)`
          : "";
        const emoji = statusEmojis[post.status] ?? "❓";
        const provider = post.provider ? escapeHtml(post.provider).padEnd(12).slice(0, 12) : "—";
        html += `<blockquote>${emoji} #${post.index}  ${post.time}  ${post.category}  ${provider}  ${post.status}${overdue}</blockquote>\n`;
      }

      if (failed > 0) {
        html += `\n<i>💡 Failed slots won't retry automatically. Use "Regenerate" to create a fresh plan.</i>`;
      }

      return html;
    } catch (error) {
      return `<b>━━━ 📋 Daily Plan ━━━</b>\n\n❌ Failed to load plan: ${escapeHtml(error instanceof Error ? error.message : String(error))}`;
    }
  },

  keyboard(_settings: FredySettings, _ctx?: ScreenContext): InlineKeyboard {
    const rows: { text: string; callback_data: string }[][] = [];

    // Action buttons
    rows.push([
      { text: "⚡ Fire Next Due", callback_data: "plan:firenext" },
      { text: "🔄 Regenerate", callback_data: "plan:regenerate" },
    ]);
    rows.push([
      { text: "🔬 Scheduler Debug", callback_data: "menu:schedulerdebug" },
    ]);
    rows.push([{ text: "🔙 Back to Menu", callback_data: "menu:main" }]);

    return buildKeyboard(rows);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    const action = parts[1];

    if (action === "firenext") {
      // v11.4.0: CRITICAL FIX — previously called scheduler.tick() which fires
      // ALL due slots. Now generates ONE fresh post and publishes it, WITHOUT
      // touching the scheduler. This prevents the "double publish" bug.
      try {
        const settings = await ctx.container.config.getSettings(Number(ctx.container.env.ADMIN_ID ?? "0"));
        const lang = settings.language.default;
        const result = await ctx.container.content.processForCategory(
          "A", null, lang, { skipEnqueue: true },
        );
        if (result.ok && result.content) {
          const pubResult = await ctx.container.finalPublisher.publish(result.content);
          if (pubResult.ok) {
            await ctx.container.duplicateDetector.recordPublished(result.content).catch(() => {});
            return { toast: `⚡ Published! (manual, not scheduled)`, redirectTo: "plan" };
          }
          return { alert: `❌ Publish failed: ${pubResult.error}` };
        }
        return { alert: `❌ No content available` };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (action === "regenerate") {
      try {
        const settings = await ctx.container.config.getSettings(Number(ctx.container.env.ADMIN_ID ?? "0"));
        const tz = settings.scheduler.timezone || "UTC";
        const today = formatDateInZone(Date.now(), tz);

        // Clear both plans + fired markers
        const { slotsKey } = await import("../../core/storage/keys");
        await ctx.container.kv.delete(slotsKey(today));
        await ctx.container.kv.delete(`fredy:strategy:plan:${today}`);
        const firedKeys = await ctx.container.kv.list(`fredy:sched:sent:${today}:`);
        for (const k of firedKeys) {
          await ctx.container.kv.delete(k).catch(() => {});
        }

        await ctx.container.strategyEngine.generatePlan();
        return { toast: "🔄 Plan regenerated", redirectTo: "plan" };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (action === "fire" && parts[2]) {
      // Fire a specific slot by index (not implemented in scheduler yet — would need API)
      return { toast: "💡 Use 'Fire Next Due' to fire the next pending slot" };
    }

    return void 0;
  },
};

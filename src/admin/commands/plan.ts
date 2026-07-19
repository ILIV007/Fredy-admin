/**
 * src/admin/commands/plan.ts
 * v11.3.0: /plan command — shows today's daily plan.
 */

import type { Command, CommandContext } from "../registry";
import { escapeHtml } from "../../primitives/strings";
import { formatDateInZone } from "../../primitives/time";

export const planCommand: Command = {
  name: "/plan",
  description: "View today's publishing plan",

  async handle(ctx: CommandContext): Promise<void> {
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

      const completed = plan.posts.filter((p) => p.status === "published" || p.status === "backup").length;
      const failed = plan.posts.filter((p) => p.status === "failed").length;
      const pending = plan.posts.filter((p) => p.status === "pending").length;
      const dueNow = plan.posts.filter((p) => p.status === "pending" && p.epochMs <= now).length;

      let html = `<b>━━━ 📋 Daily Plan (${today}) ━━━</b>\n\n`;
      html += `<blockquote>📊 Total: ${plan.posts.length} | ✅ ${completed} | ⏳ ${pending} | ⚠️ Due: ${dueNow} | ❌ ${failed}</blockquote>\n`;
      html += `<blockquote>🎯 Strategy: ${plan.strategy}</blockquote>\n\n`;

      for (const post of plan.posts) {
        const overdue = post.epochMs <= now && post.status === "pending"
          ? ` (${Math.round((now - post.epochMs) / 60000)}m overdue)`
          : "";
        const emoji = statusEmojis[post.status] ?? "❓";
        const provider = post.provider ?? "—";
        html += `<blockquote>${emoji} #${post.index} ${post.time} ${post.category} ${escapeHtml(provider)}${overdue}</blockquote>\n`;
      }

      if (dueNow > 0) {
        html += `\n<b>⚠️ ${dueNow} slot(s) due NOW — will fire on next tick.</b>`;
      }

      await ctx.reply(html);
    } catch (error) {
      await ctx.reply(`❌ Failed to load plan: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  },
};

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

      // v12.0.2: Compute "due now" using exact scheduledTime (no tolerance).
      const nowInTz = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(now));
      const [nowH, nowM] = nowInTz.split(":").map(Number);
      const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

      const dueNow = plan.posts.filter((p) => {
        if (p.status !== "pending") return false;
        const schedTime = p.scheduledTime ?? p.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        return nowMinutes >= schedMin;
      }).length;

      let html = `<b>━━━ 📋 Daily Plan (${today}) — v12 ━━━</b>\n\n`;
      html += `<blockquote>📊 Total: ${plan.posts.length} | ✅ ${completed} | ⏳ ${pending} | ⚠️ Due: ${dueNow} | ❌ ${failed}</blockquote>\n`;
      html += `<blockquote>🎯 Strategy: ${plan.strategy}</blockquote>\n\n`;

      // v12: Show Window | 🎯 Scheduled | Cat | Provider per slot
      for (const post of plan.posts) {
        const schedTime = post.scheduledTime ?? post.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        const overdue = (post.status === "pending" && nowMinutes >= schedMin)
          ? ` (${Math.max(0, nowMinutes - schedMin)}m overdue)`
          : "";
        const emoji = statusEmojis[post.status] ?? "❓";
        const provider = post.provider ?? "—";
        const window = `${post.time}-${post.windowEnd ?? post.time}`;
        html += `<blockquote>${emoji} #${post.index} 🪟${window} 🎯${schedTime} ${post.category} ${escapeHtml(provider)}${overdue}</blockquote>\n`;
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

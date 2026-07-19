/**
 * src/admin/commands/debug.ts
 * v11.3.0: /debug command — shows scheduler debug summary.
 */

import type { Command, CommandContext } from "../registry";
import { escapeHtml } from "../../primitives/strings";
import { formatDateInZone } from "../../primitives/time";

export const debugCommand: Command = {
  name: "/debug",
  description: "Scheduler debug summary (due slots, lock, last tick)",

  async handle(ctx: CommandContext): Promise<void> {
    try {
      const now = Date.now();
      const settings = await ctx.container.config.getSettings(Number(ctx.container.env.ADMIN_ID ?? "0"));
      const tz = settings.scheduler.timezone || "UTC";
      const today = formatDateInZone(now, tz);

      const localTime = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date(now));

      const plan = await ctx.container.strategyEngine.getOrGeneratePlan().catch(() => null);
      const slots = plan?.posts ?? [];
      const completed = slots.filter((s) => s.status === "published" || s.status === "backup").length;
      const pending = slots.filter((s) => s.status === "pending" && s.epochMs > now).length;
      const dueNow = slots.filter((s) => s.status === "pending" && s.epochMs <= now).length;
      const failed = slots.filter((s) => s.status === "failed").length;

      const isQuiet = ctx.container.quietHoursChecker?.isQuietHours(now, settings.scheduler) ?? false;

      const lastTickStr = await ctx.container.kv.get("fredy:tick:lastTick").catch(() => null);
      const lastTick = lastTickStr ? Number(lastTickStr) : null;
      const lastTickAgo = lastTick ? Math.round((now - lastTick) / 60000) : null;

      const lockValue = await ctx.container.kv.get("fredy:tick:lock").catch(() => null);
      const lockHeld = !!lockValue;

      const queueDepths = await ctx.container.queue.depth().catch(() => []);
      const totalQueue = queueDepths.reduce((sum, q) => sum + q.depth, 0);

      const todayHistory = await ctx.container.history.getToday().catch(() => ({ entries: [] }));
      const lastPublished = todayHistory.entries.find((e) => e.telegramMessageId > 0);
      const lastPublishAgo = lastPublished ? Math.round((now - lastPublished.publishedAt) / 60000) : null;

      const dueSlots = slots.filter((s) => s.status === "pending" && s.epochMs <= now);
      let dueSlotsHtml = "";
      if (dueSlots.length > 0) {
        dueSlotsHtml = `\n<b>⚠️ Due Slots (fire next tick):</b>\n`;
        for (const s of dueSlots) {
          const overdue = Math.round((now - s.epochMs) / 60000);
          const overdueStr = overdue > 180 ? `🔴 ${overdue}m` : `🟡 ${overdue}m`;
          dueSlotsHtml += `<blockquote>#${s.index} ${s.time} ${s.category} — ${overdueStr}</blockquote>\n`;
        }
      }

      const html = [
        `<b>━━━ 🔬 Scheduler Debug ━━━</b>`,
        ``,
        `<blockquote>🕐 ${localTime} (${tz}) | ${today}</blockquote>`,
        `<blockquote>⚙️ Sched: ${settings.scheduler.enabled ? "🟢" : "🔴"} | Bot: ${settings.general.botEnabled ? "🟢" : "🔴"} | Quiet: ${isQuiet ? "🔴" : "🟢"}</blockquote>`,
        `<blockquote>📋 Plan: ${slots.length} total | ✅ ${completed} | ⏳ ${pending} | ⚠️ Due: ${dueNow} | ❌ ${failed}</blockquote>`,
        dueSlotsHtml,
        `<blockquote>🔒 Lock: ${lockHeld ? "🔴 HELD" : "🟢 Free"} | ⏰ Tick: ${lastTickAgo !== null ? lastTickAgo + "m ago" : "—"} | 📤 Publish: ${lastPublishAgo !== null ? lastPublishAgo + "m ago" : "—"}</blockquote>`,
        `<blockquote>📥 Queue: ${totalQueue} items</blockquote>`,
      ].filter(Boolean).join("\n");

      await ctx.reply(html);
    } catch (error) {
      await ctx.reply(`❌ Debug failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  },
};

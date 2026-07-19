/**
 * src/admin/screens/schedulerdebug.ts
 * v11.3.0: Scheduler Debug screen for the Telegram bot.
 *
 * Shows a real-time snapshot of the scheduler state:
 *   - Current time (local + UTC)
 *   - Scheduler/bot/maintenance/approve status
 *   - Quiet hours status
 *   - Grace period & stale-tick threshold
 *   - Daily plan summary
 *   - Due slots (will fire on next tick)
 *   - Lock status
 *   - Last tick & last publish
 *   - Queue depths
 */

import type { Screen, ScreenAction } from "../registry";
import type { ScreenContext } from "../registry";
import type { InlineKeyboard } from "../../types/telegram";
import { escapeHtml } from "../../primitives/strings";
import { formatDateInZone } from "../../primitives/time";
import { buildKeyboard } from "../keyboards";

export const schedulerDebugScreen: Screen = {
  id: "schedulerdebug",

  async text(ctx: ScreenContext): Promise<string> {
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
      const publishing = slots.filter((s) => s.status === "publishing").length;

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

      // Due slots detail
      const dueSlots = slots.filter((s) => s.status === "pending" && s.epochMs <= now);
      let dueSlotsHtml = "";
      if (dueSlots.length > 0) {
        dueSlotsHtml = `\n<b>⚠️ Due Slots (will fire next tick):</b>\n`;
        for (const s of dueSlots) {
          const overdue = Math.round((now - s.epochMs) / 60000);
          const overdueStr = overdue > 180 ? `🔴 ${overdue}m` : `🟡 ${overdue}m`;
          dueSlotsHtml += `<blockquote>#${s.index} ${s.time} ${s.category} — ${overdueStr} overdue</blockquote>\n`;
        }
      }

      const html = [
        `<b>━━━ 🔬 Scheduler Debug ━━━</b>`,
        ``,
        `<b>🕐 Current Time</b>`,
        `<blockquote>Local: ${localTime} (${tz})</blockquote>`,
        `<blockquote>UTC: ${new Date(now).toISOString().slice(11, 19)}</blockquote>`,
        `<blockquote>Date: ${today}</blockquote>`,
        ``,
        `<b>⚙️ Scheduler State</b>`,
        `<blockquote>Scheduler: ${settings.scheduler.enabled ? "🟢 ON" : "🔴 OFF"}</blockquote>`,
        `<blockquote>Bot: ${settings.general.botEnabled ? "🟢 ON" : "🔴 OFF"}</blockquote>`,
        `<blockquote>Maintenance: ${settings.general.maintenanceMode ? "🟡 ON" : "🟢 OFF"}</blockquote>`,
        `<blockquote>Approve: ${settings.approveMode ? "🟡 ON" : "🟢 OFF"}</blockquote>`,
        `<blockquote>Quiet Hours: ${isQuiet ? "🔴 ACTIVE" : "🟢 No"}</blockquote>`,
        ``,
        `<b>⏰ Grace & Thresholds</b>`,
        `<blockquote>Grace: 4h | Stale alert: 3h</blockquote>`,
        ``,
        `<b>📋 Plan Summary</b>`,
        `<blockquote>Total: ${slots.length} | ✅ ${completed} | ⏳ ${pending} | ⚠️ Due: ${dueNow} | 🔄 ${publishing} | ❌ ${failed}</blockquote>`,
        dueSlotsHtml,
        `<b>🔒 Lock & Tick</b>`,
        `<blockquote>Lock: ${lockHeld ? "🔴 HELD" : "🟢 Free"}</blockquote>`,
        `<blockquote>Last Tick: ${lastTickAgo !== null ? lastTickAgo + "min ago" : "—"}</blockquote>`,
        `<blockquote>Last Publish: ${lastPublishAgo !== null ? lastPublishAgo + "min ago" : "—"}</blockquote>`,
        ``,
        `<b>📥 Queue: ${totalQueue} items</b>`,
        ...queueDepths.map((q) => `<blockquote>Cat ${q.category}: ${q.depth}</blockquote>`),
      ].filter(Boolean).join("\n");

      return html;
    } catch (error) {
      return `<b>━━━ 🔬 Scheduler Debug ━━━</b>\n\n❌ Error: ${escapeHtml(error instanceof Error ? error.message : String(error))}`;
    }
  },

  keyboard(): InlineKeyboard {
    const rows = [
      [
        { text: "⚡ Force Publish", callback_data: "sdebug:force" },
        { text: "🔄 Refresh", callback_data: "menu:schedulerdebug" },
      ],
      [
        { text: "📋 View Plan", callback_data: "menu:plan" },
        { text: "🔄 Regenerate Plan", callback_data: "sdebug:regenerate" },
      ],
      [{ text: "🔙 Back to Menu", callback_data: "menu:main" }],
    ];
    return buildKeyboard(rows);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    const action = parts[1];

    if (action === "force") {
      // v11.4.0: CRITICAL FIX — previously called scheduler.tick() which fires
      // ALL due slots (causing double-publish when manual + scheduled overlap).
      // Now generates ONE fresh post and publishes it, WITHOUT touching scheduler.
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
            return { toast: `⚡ Published! (manual, not scheduled)`, redirectTo: "schedulerdebug" };
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

        const { slotsKey } = await import("../../core/storage/keys");
        await ctx.container.kv.delete(slotsKey(today));
        await ctx.container.kv.delete(`fredy:strategy:plan:${today}`);
        const firedKeys = await ctx.container.kv.list(`fredy:sched:sent:${today}:`);
        for (const k of firedKeys) {
          await ctx.container.kv.delete(k).catch(() => {});
        }

        await ctx.container.strategyEngine.generatePlan();
        return { toast: "🔄 Plan regenerated", redirectTo: "schedulerdebug" };
      } catch (error) {
        return { alert: `❌ ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    return void 0;
  },
};

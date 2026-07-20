/**
 * src/admin/screens/schedule.ts
 * Scheduler screen — enable/disable, view next jobs, random offset.
 *
 * Now consumes the section-based SchedulerConfig.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, stepperRow, labelButton } from "../keyboards";
import { header, kv, statusBadge, divider, formatTime } from "../helpers/formatting";

export const scheduleScreen: Screen = {
  id: "schedule",

  async text(ctx) {
    const sched = ctx.settings.scheduler;
    const status = await ctx.container.scheduler.status();

    // v12: Fetch strategy plan for Daily Plan table (Window | Scheduled format).
    let dailyPlanHtml = "";
    try {
      const plan = await ctx.container.strategyEngine.getOrGeneratePlan();
      if (plan && plan.posts && plan.posts.length > 0) {
        const statusLines = plan.posts.map(p => {
          let s = p.status || "pending";
          // Check if fired from scheduler status.
          if (status.today && status.today.slots) {
            const firedSlot = status.today.slots.find(sl => sl.index === p.index);
            if (firedSlot && firedSlot.fired) s = "published";
          }
          const icon = s === "published" ? "✅" : s === "failed" ? "⏭️" : s === "backup" ? "♻️" : s === "publishing" ? "🔄" : "⏳";
          // v12: Show Window | 🎯 Scheduled | Cat | Provider
          const win = `${p.time}-${p.windowEnd ?? p.time}`;
          const sched = p.scheduledTime ?? p.time;
          return `${icon} #${p.index} 🪟${win} 🎯${sched} | ${p.category} | ${p.provider || "—"}`;
        });
        dailyPlanHtml = `\n${header("Daily Plan (v12)", "📋")}\n${statusLines.join("\n")}\n`;
      }
    } catch { /* non-fatal */ }

    return [
      header("Scheduler (v12)", "📅"),
      "",
      kv("Enabled", statusBadge(sched.enabled)),
      kv("Timezone", sched.timezone),
      kv("Posting windows", sched.postingWindows.length || "(any time)"),
      kv("Quiet hours", sched.quietHours ? `${sched.quietHours.start}–${sched.quietHours.end}` : "(none)"),
      kv("Legacy slots", sched.slots.join(", ")),
      kv("Jitter", `±${sched.jitterMinutes} min`),
      kv("Min gap", `${sched.minGapMinutes} min`),
      kv("Burst posting", statusBadge(sched.burstPosting)),
      kv("Skip low quality", statusBadge(sched.skipIfLowQuality)),
      "",
      header("Status", "📊"),
      kv("Next slot", status.nextSlot ? `${status.nextSlot.scheduledTime ?? status.nextSlot.time}` : "(none)"),
      kv("Posts today", status.postsPublishedToday ?? 0),
      kv("Queue depth", status.queueDepth),
      kv("Last fired", formatTime(status.lastFiredAt)),
      dailyPlanHtml,
      divider(),
      "<i>v12: Window + Random Jitter + Three-Layer Cron. Tap toggles to configure.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const sched = s.scheduler;
    return buildKeyboardWithBack([
      [toggleButton("Scheduler", sched.enabled, "set:scheduler:toggle")],
      [labelButton("─── Slots ───")],
      [labelButton(`Slots: ${sched.slots.join(", ")}`)],
      [labelButton("─── Jitter ───")],
      stepperRow("Jitter", sched.jitterMinutes, "set:scheduler:jitter:dec", "set:scheduler:jitter:inc", "m"),
      [labelButton("─── Behavior ───")],
      [toggleButton("Burst", sched.burstPosting, "set:scheduler:burst:toggle")],
      [toggleButton("Skip low Q", sched.skipIfLowQuality, "set:scheduler:skipLowQ:toggle")],
      [labelButton("─── Actions ───")],
      [{ text: "🔄 Refresh status", callback_data: "action:scheduler:refresh" }],
      [{ text: "▶️ Force tick", callback_data: "action:scheduler:forceTick" }],
      [{ text: "♻️ Regenerate Plan", callback_data: "action:scheduler:regenerate" }],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 3) return;
    const first = parts[0] ?? "";
    const second = parts[1] ?? "";
    const third = parts[2] ?? "";
    const fourth = parts[3] ?? "";
    const sched = ctx.settings.scheduler;
    let patch: Partial<FredySettings> = {};

    // Handle "set:scheduler:<field>:<action>"
    if (first === "set" && second === "scheduler") {
      if (third === "toggle" && fourth === "") {
        // "set:scheduler:toggle" — 3 parts, fourth is empty
        patch = { scheduler: { ...sched, enabled: !sched.enabled } };
      } else if (third === "toggle") {
        // "set:scheduler:toggle:..." — shouldn't happen but handle
        patch = { scheduler: { ...sched, enabled: !sched.enabled } };
      } else if (third === "jitter") {
        const next = fourth === "inc" ? Math.min(120, sched.jitterMinutes + 5) : Math.max(0, sched.jitterMinutes - 5);
        patch = { scheduler: { ...sched, jitterMinutes: next } };
      } else if (third === "burst" && fourth === "toggle") {
        patch = { scheduler: { ...sched, burstPosting: !sched.burstPosting } };
      } else if (third === "skipLowQ" && fourth === "toggle") {
        patch = { scheduler: { ...sched, skipIfLowQuality: !sched.skipIfLowQuality } };
      }
    }

    // Handle "action:scheduler:<op>"
    if (first === "action" && second === "scheduler") {
      const op = third;
      if (op === "refresh") {
        return { toast: "🔄 Status refreshed" };
      }
      if (op === "forceTick") {
        const result = await ctx.container.scheduler.tick();
        return result.fired
          ? { toast: `✅ Slot fired: ${result.slot?.category}` }
          : { toast: `⏭️ Skipped: ${result.skipReason}` };
      }
      if (op === "regenerate") {
        try {
          const { formatDateInZone } = await import("../../primitives/time");
          const { slotsKey } = await import("../../core/storage/keys");
          const settings = await ctx.container.config.getSettings(ctx.adminId);
          const today = formatDateInZone(Date.now(), settings.scheduler.timezone);
          // v8.7.0: Clear BOTH plans (daily planner + strategy).
          await ctx.container.kv.delete(slotsKey(today));
          await ctx.container.kv.delete(`fredy:strategy:plan:${today}`);
          const firedKeys = await ctx.container.kv.list(`fredy:sched:sent:${today}:`);
          for (const k of firedKeys) {
            await ctx.container.kv.delete(k).catch(() => {});
          }
          await ctx.container.strategyEngine.generatePlan();
          return { toast: `♻️ Plan regenerated` };
        } catch (e) {
          return { alert: `❌ Regenerate failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
    }

    if (Object.keys(patch).length === 0) return;
    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) return { alert: `❌ ${result.error}` };
    return { toast: "✅ Updated" };
  },
};

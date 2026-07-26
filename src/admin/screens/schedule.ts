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
        // v12.3.1: Unified status emoji set with the dashboard tables + plan.ts.
        // v13.0.2: Sort by scheduledTime so H slots are interleaved with A/B/C.
        const sortedPosts = [...plan.posts].sort((a, b) => {
          const ta = (a.scheduledTime ?? a.time) || "";
          const tb = (b.scheduledTime ?? b.time) || "";
          return ta.localeCompare(tb);
        });
        const statusLines = sortedPosts.map(p => {
          let s = p.status || "pending";
          // Check if fired from scheduler status.
          if (status.today && status.today.slots) {
            const firedSlot = status.today.slots.find(sl => sl.index === p.index);
            if (firedSlot && firedSlot.fired) s = "published";
          }
          const icon = s === "published" ? "✅"
            : s === "failed" ? "❌"
            : s === "backup" ? "♻️"
            : s === "publishing" ? "🔄"
            : s === "skipped" ? "⏭️"
            : "⏳";
          // v12: Show Window | 🎯 Scheduled | Cat | Provider
          const win = `${p.time}-${p.windowEnd ?? p.time}`;
          const sched = p.scheduledTime ?? p.time;
          return `${icon} #${p.index} 🪟${win} 🎯${sched} | ${p.category} | ${p.provider || "—"}`;
        });
        dailyPlanHtml = `\n${header("Daily Plan (v13)", "📋")}\n${statusLines.join("\n")}\n`;
      }
    } catch { /* non-fatal */ }

    // v13.0.8: Show Tier V (NASA) status.
    let tierVHtml = "";
    try {
      const settings = ctx.settings;
      const tierVEntries = settings.tierV?.entries ?? [];
      if (tierVEntries.length > 0) {
        const today = new Intl.DateTimeFormat("en-US", { timeZone: sched.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("/").reverse().join("-");
        const tierVLines: string[] = [];
        for (const entry of tierVEntries) {
          if (!entry.enabled) continue;
          const sentKey = `fredy:tierV:sent:${today}:${entry.id}`;
          const sent = await ctx.container.kv.get(sentKey).catch(() => null);
          const pubEmoji = sent ? "✅" : "⏳";
          tierVLines.push(`${pubEmoji} 🟣 ${entry.time} ${entry.providerId} — ${entry.description || entry.id}`);
        }
        if (tierVLines.length > 0) {
          tierVHtml = `\n${header("Tier V (v13)", "🟣")}\n${tierVLines.join("\n")}\n`;
        }
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
      tierVHtml,
      divider(),
      "<i>v13: Random Window Shuffling + Tier H + Tier V. Tap toggles to configure.</i>",
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

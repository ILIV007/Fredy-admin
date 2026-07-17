/**
 * src/admin/screens/schedule.ts
 * Scheduler screen — enable/disable, view today's slots, view last 5 published
 * posts, force tick.
 *
 * v7.4.0: Now also shows the post history inline (last 5 published posts) so
 * the admin can review recently-published content without leaving the bot.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, stepperRow, labelButton } from "../keyboards";
import { header, kv, statusBadge, divider, formatTime, formatRelativeTime } from "../helpers/formatting";
import { escapeHtml } from "../../primitives/strings";

export const scheduleScreen: Screen = {
  id: "schedule",

  async text(ctx) {
    const sched = ctx.settings.scheduler;
    const status = await ctx.container.scheduler.status().catch(() => null);

    // ── Today's slots ──
    const todaySlots = status?.today?.slots ?? [];
    let slotsText: string;
    if (todaySlots.length === 0) {
      slotsText = "(no slots scheduled)";
    } else {
      const lines = todaySlots.map(s => {
        const icon = s.fired ? "✅" : "⏳";
        return `${icon} ${s.time} — Cat ${s.category}`;
      });
      slotsText = lines.join("\n");
    }

    // ── Last 5 published posts (history) ──
    let historyText: string;
    try {
      const recent = await ctx.container.history.getRecent(3);
      const last5 = recent.filter(e => e.telegramMessageId > 0).slice(0, 5);
      if (last5.length === 0) {
        historyText = "(no posts published yet)";
      } else {
        historyText = last5.map((e, i) => {
          const preview = (e.textPreview ?? "").slice(0, 60);
          const time = formatRelativeTime(e.publishedAt);
          return `${i + 1}. [${e.category}] ${escapeHtml(preview)}${(e.textPreview ?? "").length > 60 ? "…" : ""}\n   ${time} • ${escapeHtml(e.pluginId)} • ${e.qualityScore}q`;
        }).join("\n");
      }
    } catch {
      historyText = "(history unavailable)";
    }

    return [
      header("Scheduler", "📅"),
      "",
      kv("Enabled", statusBadge(sched.enabled)),
      kv("Timezone", sched.timezone),
      kv("Jitter", `±${sched.jitterMinutes} min`),
      kv("Burst posting", statusBadge(sched.burstPosting)),
      kv("Skip low quality", statusBadge(sched.skipIfLowQuality)),
      "",
      header("Status", "📊"),
      kv("Next slot", status?.nextSlot ? formatTime(status.nextSlot.epochMs ?? null) : "(none)"),
      kv("Queue depth", String(status?.queueDepth ?? 0)),
      kv("Posts today", String(status?.postsPublishedToday ?? 0)),
      kv("Last fired", formatTime(status?.lastFiredAt ?? null)),
      "",
      header("Today's Slots", "📆"),
      slotsText,
      "",
      header("Last 5 Published Posts", "📜"),
      historyText,
      "",
      divider(),
      "<i>Tap toggles and steppers to configure.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const sched = s.scheduler;
    return buildKeyboardWithBack([
      [toggleButton("Scheduler", sched.enabled, "set:scheduler:toggle")],
      [labelButton("─── Jitter ───")],
      stepperRow("Jitter", sched.jitterMinutes, "set:scheduler:jitter:dec", "set:scheduler:jitter:inc", "m"),
      [labelButton("─── Behavior ───")],
      [toggleButton("Burst", sched.burstPosting, "set:scheduler:burst:toggle")],
      [toggleButton("Skip low Q", sched.skipIfLowQuality, "set:scheduler:skipLowQ:toggle")],
      [labelButton("─── Actions ───")],
      [{ text: "🔄 Refresh status", callback_data: "action:scheduler:refresh" }],
      [{ text: "▶️ Force tick", callback_data: "action:scheduler:forceTick" }],
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
        patch = { scheduler: { ...sched, enabled: !sched.enabled } };
      } else if (third === "toggle") {
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
    }

    if (Object.keys(patch).length === 0) return;
    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) return { alert: `❌ ${result.error}` };
    return { toast: "✅ Updated" };
  },
};

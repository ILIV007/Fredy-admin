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
    return [
      header("Scheduler", "📅"),
      "",
      kv("Enabled", statusBadge(sched.enabled)),
      kv("Timezone", sched.timezone),
      kv("Slots", sched.slots.join(", ")),
      kv("Jitter", `±${sched.jitterMinutes} min`),
      kv("Burst posting", statusBadge(sched.burstPosting)),
      kv("Skip low quality", statusBadge(sched.skipIfLowQuality)),
      kv("Posting windows", sched.postingWindows.length || "(any time)"),
      "",
      header("Status", "📊"),
      kv("Next slot", status.nextSlot ? formatTime(status.nextSlot.epochMs) : "(none)"),
      kv("Queue depth", status.queueDepth),
      kv("Last fired", formatTime(status.lastFiredAt)),
      "",
      divider(),
      "<i>Tap toggles and steppers to configure.</i>",
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
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 3) return;
    const [, scope, field, action] = parts;
    const sched = ctx.settings.scheduler;
    let patch: Partial<FredySettings> = {};

    if (scope === "scheduler") {
      if (field === "toggle") {
        patch = { scheduler: { ...sched, enabled: !sched.enabled } };
      } else if (field === "jitter") {
        const next = action === "inc" ? Math.min(120, sched.jitterMinutes + 5) : Math.max(0, sched.jitterMinutes - 5);
        patch = { scheduler: { ...sched, jitterMinutes: next } };
      } else if (field === "burst" && action === "toggle") {
        patch = { scheduler: { ...sched, burstPosting: !sched.burstPosting } };
      } else if (field === "skipLowQ" && action === "toggle") {
        patch = { scheduler: { ...sched, skipIfLowQuality: !sched.skipIfLowQuality } };
      }
    }

    if (scope === "action" && field === "scheduler") {
      if (action === "refresh") {
        return { toast: "🔄 Status refreshed" };
      }
      if (action === "forceTick") {
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

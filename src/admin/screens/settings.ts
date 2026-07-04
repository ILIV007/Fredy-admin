/**
 * src/admin/screens/settings.ts
 * Settings screen — general runtime configuration toggles.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, choiceRow, stepperRow } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

export const settingsScreen: Screen = {
  id: "settings",

  async text(ctx) {
    const s = ctx.settings;
    return [
      header("Settings", "⚙️"),
      "",
      header("General", "🔧"),
      kv("Bot enabled", statusBadge(s.general.botEnabled)),
      kv("Maintenance mode", statusBadge(s.general.maintenanceMode)),
      kv("Timezone", s.general.timezone),
      kv("Environment", s.general.environment),
      "",
      header("Content", "📝"),
      kv("Posts per day", s.content.postsPerDay),
      kv("Random offset", `${s.content.randomOffsetMinutes} min`),
      kv("Burst posting", statusBadge(s.content.burstPosting)),
      kv("Duplicate prevention", statusBadge(s.content.duplicatePrevention)),
      "",
      header("Language", "🌐"),
      kv("Default", s.language.default),
      kv("Supported", s.language.supported.join(", ")),
      kv("Auto-detect", statusBadge(s.language.autoDetect)),
      "",
      header("Quality", "🎯"),
      kv("Min score", s.quality.minScore),
      kv("Min length", s.quality.minLength),
      kv("Max length", s.quality.maxLength),
      "",
      divider(),
      "<i>Tap toggles to change values.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    return buildKeyboardWithBack([
      [toggleButton("Bot", s.general.botEnabled, "set:general:botEnabled:toggle")],
      [toggleButton("Maintenance", s.general.maintenanceMode, "set:general:maintenance:toggle")],
      choiceRow("Language", ["auto", "en", "fa"] as const, s.language.default, (v) => `set:language:default:${v}`),
      stepperRow("Posts/day", s.content.postsPerDay, "set:content:postsPerDay:dec", "set:content:postsPerDay:inc"),
      stepperRow("Quality", s.quality.minScore, "set:quality:minScore:dec", "set:quality:minScore:inc", ""),
      [toggleButton("Burst", s.content.burstPosting, "set:content:burst:toggle")],
      [toggleButton("Dedup", s.content.duplicatePrevention, "set:content:dedup:toggle")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: set:<scope>:<field>[:value | :toggle]
    if (parts.length < 4) return;
    const [, scope, field, action] = parts;
    const value = parts.slice(4).join(":");

    let patch: Partial<FredySettings> = {};

    if (scope === "general") {
      if (field === "botEnabled" && action === "toggle") {
        patch = { general: { ...ctx.settings.general, botEnabled: !ctx.settings.general.botEnabled } };
      } else if (field === "maintenance" && action === "toggle") {
        patch = { general: { ...ctx.settings.general, maintenanceMode: !ctx.settings.general.maintenanceMode } };
      }
    } else if (scope === "language") {
      if (field === "default") {
        patch = { language: { ...ctx.settings.language, default: value as "auto" | "en" | "fa" } };
      }
    } else if (scope === "content") {
      if (field === "postsPerDay") {
        const current = ctx.settings.content.postsPerDay;
        const next = action === "inc" ? Math.min(20, current + 1) : Math.max(1, current - 1);
        patch = { content: { ...ctx.settings.content, postsPerDay: next } };
      } else if (field === "burst" && action === "toggle") {
        patch = { content: { ...ctx.settings.content, burstPosting: !ctx.settings.content.burstPosting } };
      } else if (field === "dedup" && action === "toggle") {
        patch = { content: { ...ctx.settings.content, duplicatePrevention: !ctx.settings.content.duplicatePrevention } };
      }
    } else if (scope === "quality") {
      if (field === "minScore") {
        const current = ctx.settings.quality.minScore;
        const next = action === "inc" ? Math.min(100, current + 5) : Math.max(0, current - 5);
        patch = { quality: { ...ctx.settings.quality, minScore: next } };
      }
    }

    if (Object.keys(patch).length === 0) return;

    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) {
      return { alert: `❌ Validation failed: ${result.error}` };
    }
    return { toast: "✅ Updated" };
  },
};

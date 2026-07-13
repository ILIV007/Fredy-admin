/**
 * src/admin/screens/editor.ts
 * Editor screen — post formatting settings (from ai-admin).
 * Controls: edit intensity, emoji level, rewrite mode, formatting style.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, labelButton, stepperRow, choiceRow } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

export const editorScreen: Screen = {
  id: "editor",

  async text(ctx) {
    const s = ctx.settings;
    const ai = s?.ai;
    const content = s?.content;
    return [
      header("Post Editor", "🎨"),
      "",
      "Control how Fredy formats and rewrites posts before publishing.",
      "",
      header("AI Rewrite", "✍️"),
      kv("Temperature", String(ai?.temperature ?? 0.7)),
      kv("Max Tokens", String(ai?.maxTokens ?? 2500)),
      kv("Quality Threshold", String(ai?.qualityThreshold ?? 60)),
      kv("Prompt Profile", ai?.promptProfile ?? "default"),
      "",
      header("Formatting", "📝"),
      kv("Posts per day", String(content?.postsPerDay ?? 4)),
      kv("Footer format", content?.sourceFooterFormat ?? "{emoji}Source"),
      kv("Emoji pool size", String(content?.sourceEmojiPool?.length ?? 20)),
      kv("Emoji history", String(content?.emojiHistorySize ?? 10)),
      kv("Burst posting", statusBadge(content?.burstPosting ?? false)),
      "",
      header("Quality", "🎯"),
      kv("Min score", String(s?.quality?.minScore ?? 60)),
      kv("Min length", String(s?.quality?.minLength ?? 80)),
      kv("Max length", String(s?.quality?.maxLength ?? 4096)),
      kv("Spam protection", statusBadge(s?.quality?.spamProtection ?? true)),
      kv("Duplicate detection", statusBadge(s?.quality?.duplicateDetection ?? true)),
      "",
      divider(),
      "<i>Tap buttons below to adjust settings.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const ai = s?.ai;
    const content = s?.content;
    const quality = s?.quality;
    return buildKeyboardWithBack([
      [labelButton("─── AI Rewrite ───")],
      choiceRow("Profile", ["default", "concise", "detailed"] as const, ai?.promptProfile ?? "default", (v) => `set:ai:profile:${v}`),
      stepperRow("Temp", ai?.temperature ?? 0.7, "set:ai:temp:dec", "set:ai:temp:inc", ""),
      stepperRow("Quality", ai?.qualityThreshold ?? 60, "set:ai:quality:dec", "set:ai:quality:inc", ""),
      stepperRow("MaxTok", ai?.maxTokens ?? 2500, "set:ai:maxTokens:dec", "set:ai:maxTokens:inc", ""),
      [labelButton("─── Formatting ───")],
      stepperRow("Posts/day", content?.postsPerDay ?? 4, "set:content:postsPerDay:dec", "set:content:postsPerDay:inc"),
      [toggleButton("Burst", content?.burstPosting ?? false, "set:content:burst:toggle")],
      [toggleButton("Dedup", content?.duplicatePrevention ?? true, "set:content:dedup:toggle")],
      [labelButton("─── Quality ───")],
      stepperRow("MinScore", quality?.minScore ?? 60, "set:quality:minScore:dec", "set:quality:minScore:inc", ""),
      stepperRow("MinLen", quality?.minLength ?? 80, "set:quality:minLength:dec", "set:quality:minLength:inc", ""),
      [toggleButton("Spam", quality?.spamProtection ?? true, "set:quality:spam:toggle")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 4) return;
    const first = parts[0] ?? "";
    const second = parts[1] ?? "";
    const third = parts[2] ?? "";
    const fourth = parts[3] ?? "";

    let patch: Partial<FredySettings> = {};

    // AI settings
    if (first === "set" && second === "ai") {
      const ai = ctx.settings?.ai;
      if (!ai) return { alert: "❌ AI config missing" };
      if (third === "profile") {
        patch = { ai: { ...ai, promptProfile: fourth as "default" | "concise" | "detailed" } };
      } else if (third === "temp") {
        const next = fourth === "inc" ? Math.min(2, ai.temperature + 0.1) : Math.max(0, ai.temperature - 0.1);
        patch = { ai: { ...ai, temperature: Math.round(next * 10) / 10 } };
      } else if (third === "quality") {
        const next = fourth === "inc" ? Math.min(100, ai.qualityThreshold + 5) : Math.max(0, ai.qualityThreshold - 5);
        patch = { ai: { ...ai, qualityThreshold: next } };
      } else if (third === "maxTokens") {
        const next = fourth === "inc" ? Math.min(8192, ai.maxTokens + 256) : Math.max(256, ai.maxTokens - 256);
        patch = { ai: { ...ai, maxTokens: next } };
      }
    }

    // Content settings
    if (first === "set" && second === "content") {
      const content = ctx.settings?.content;
      if (!content) return { alert: "❌ Content config missing" };
      if (third === "postsPerDay") {
        const next = fourth === "inc" ? Math.min(20, content.postsPerDay + 1) : Math.max(1, content.postsPerDay - 1);
        patch = { content: { ...content, postsPerDay: next } };
      } else if (third === "burst" && fourth === "toggle") {
        patch = { content: { ...content, burstPosting: !content.burstPosting } };
      } else if (third === "dedup" && fourth === "toggle") {
        patch = { content: { ...content, duplicatePrevention: !content.duplicatePrevention } };
      }
    }

    // Quality settings
    if (first === "set" && second === "quality") {
      const quality = ctx.settings?.quality;
      if (!quality) return { alert: "❌ Quality config missing" };
      if (third === "minScore") {
        const next = fourth === "inc" ? Math.min(100, quality.minScore + 5) : Math.max(0, quality.minScore - 5);
        patch = { quality: { ...quality, minScore: next } };
      } else if (third === "minLength") {
        const next = fourth === "inc" ? Math.min(1000, quality.minLength + 10) : Math.max(0, quality.minLength - 10);
        patch = { quality: { ...quality, minLength: next } };
      } else if (third === "spam" && fourth === "toggle") {
        patch = { quality: { ...quality, spamProtection: !quality.spamProtection } };
      }
    }

    if (Object.keys(patch).length === 0) return;
    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) return { alert: `❌ ${result.error}` };
    return { toast: "✅ Updated" };
  },
};

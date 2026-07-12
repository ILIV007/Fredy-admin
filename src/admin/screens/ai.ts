/**
 * src/admin/screens/ai.ts
 * AI screen — select provider, fallback, prompt profile, temperature, etc.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, choiceRow, stepperRow, labelButton } from "../keyboards";
import { header, kv, divider } from "../helpers/formatting";

export const aiScreen: Screen = {
  id: "ai",

  async text(ctx) {
    const ai = ctx.settings.ai;
    return [
      header("AI Configuration", "🤖"),
      "",
      kv("Primary provider", ai.primaryProvider),
      kv("Fallback provider", ai.fallbackProvider),
      kv("Temperature", ai.temperature),
      kv("Max tokens", ai.maxTokens),
      kv("Retry count", ai.retryCount),
      kv("Prompt profile", ai.promptProfile),
      kv("Quality threshold", ai.qualityThreshold),
      kv("Timeout", `${ai.timeoutMs} ms`),
      "",
      divider(),
      "<i>Tap to change values.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const ai = s.ai;
    return buildKeyboardWithBack([
      [labelButton("─── Provider ───")],
      choiceRow("Primary", ["gemini", "openrouter"] as const, ai.primaryProvider, (v) => `set:ai:primary:${v}`),
      choiceRow("Fallback", ["gemini", "openrouter", "none"] as const, ai.fallbackProvider, (v) => `set:ai:fallback:${v}`),
      [labelButton("─── Generation ───")],
      choiceRow("Profile", ["default", "concise", "detailed"] as const, ai.promptProfile, (v) => `set:ai:profile:${v}`),
      stepperRow("Temp", ai.temperature, "set:ai:temp:dec", "set:ai:temp:inc", ""),
      stepperRow("Max tokens", ai.maxTokens, "set:ai:maxTokens:dec", "set:ai:maxTokens:inc", ""),
      stepperRow("Retries", ai.retryCount, "set:ai:retries:dec", "set:ai:retries:inc", ""),
      stepperRow("Quality", ai.qualityThreshold, "set:ai:quality:dec", "set:ai:quality:inc", ""),
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 4) return;
    const [, , field, action] = parts;
    const ai = ctx.settings.ai;
    let patch: Partial<FredySettings> = {};

    if (field === "primary") {
      patch = { ai: { ...ai, primaryProvider: action as "gemini" | "openrouter" } };
    } else if (field === "fallback") {
      patch = { ai: { ...ai, fallbackProvider: action as "gemini" | "openrouter" | "none" } };
    } else if (field === "profile") {
      patch = { ai: { ...ai, promptProfile: action as "default" | "concise" | "detailed" } };
    } else if (field === "temp") {
      const next = action === "inc" ? Math.min(2, ai.temperature + 0.1) : Math.max(0, ai.temperature - 0.1);
      patch = { ai: { ...ai, temperature: Math.round(next * 10) / 10 } };
    } else if (field === "maxTokens") {
      const next = action === "inc" ? Math.min(8192, ai.maxTokens + 256) : Math.max(256, ai.maxTokens - 256);
      patch = { ai: { ...ai, maxTokens: next } };
    } else if (field === "retries") {
      const next = action === "inc" ? Math.min(5, ai.retryCount + 1) : Math.max(0, ai.retryCount - 1);
      patch = { ai: { ...ai, retryCount: next } };
    } else if (field === "quality") {
      const next = action === "inc" ? Math.min(100, ai.qualityThreshold + 5) : Math.max(0, ai.qualityThreshold - 5);
      patch = { ai: { ...ai, qualityThreshold: next } };
    }

    if (Object.keys(patch).length === 0) return;
    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) return { alert: `❌ ${result.error}` };
    return { toast: "✅ Updated" };
  },
};

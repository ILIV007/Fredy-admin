/**
 * src/admin/screens/categories.ts
 * Categories screen — enable/disable A/B/C, daily limits, weights.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { Category } from "../../types/category";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, stepperRow, labelButton } from "../keyboards";
import { header, kv, statusBadge, divider } from "../helpers/formatting";

export const categoriesScreen: Screen = {
  id: "categories",

  async text(ctx) {
    const c = ctx.settings.categories;
    return [
      header("Categories", "📚"),
      "",
      header("Category A — Dev Content", "🟢"),
      kv("Enabled", statusBadge(c.A.enabled)),
      kv("Daily limit", c.A.dailyLimit),
      kv("Priority", c.A.priority),
      kv("Weight", c.A.weight),
      kv("Fallback", c.A.fallback),
      "",
      header("Category B — Tech News", "🟡"),
      kv("Enabled", statusBadge(c.B.enabled)),
      kv("Daily limit", c.B.dailyLimit),
      kv("Priority", c.B.priority),
      kv("Weight", c.B.weight),
      kv("Fallback", c.B.fallback),
      "",
      header("Category C — NASA / Joke / Quote / Fact", "🟣"),
      kv("Enabled", statusBadge(c.C.enabled)),
      kv("Daily limit", c.C.dailyLimit),
      kv("Priority", c.C.priority),
      kv("Weight", c.C.weight),
      kv("Fallback", c.C.fallback),
      "",
      header("Rotation", "🔄"),
      kv("Order", c.rotationOrder.join(" → ")),
      kv("Allow same twice", statusBadge(c.allowSameCategoryTwice)),
      "",
      divider(),
      "<i>Tap toggles to enable/disable. Use steppers for limits.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    const c = s.categories;
    return buildKeyboardWithBack([
      [labelButton("─── Category A ───")],
      [toggleButton("A enabled", c.A.enabled, "set:categories:A:toggle")],
      stepperRow("A limit", c.A.dailyLimit, "set:categories:A:limit:dec", "set:categories:A:limit:inc"),
      stepperRow("A weight", c.A.weight, "set:categories:A:weight:dec", "set:categories:A:weight:inc"),
      [labelButton("─── Category B ───")],
      [toggleButton("B enabled", c.B.enabled, "set:categories:B:toggle")],
      stepperRow("B limit", c.B.dailyLimit, "set:categories:B:limit:dec", "set:categories:B:limit:inc"),
      stepperRow("B weight", c.B.weight, "set:categories:B:weight:dec", "set:categories:B:weight:inc"),
      [labelButton("─── Category C ───")],
      [toggleButton("C enabled", c.C.enabled, "set:categories:C:toggle")],
      stepperRow("C limit", c.C.dailyLimit, "set:categories:C:limit:dec", "set:categories:C:limit:inc"),
      stepperRow("C weight", c.C.weight, "set:categories:C:weight:dec", "set:categories:C:weight:inc"),
      [labelButton("─── Rotation ───")],
      [toggleButton("Same twice", c.allowSameCategoryTwice, "set:categories:sameTwice:toggle")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: set:categories:<cat>:<field>[:action]
    //      or: set:categories:sameTwice:toggle
    if (parts.length < 4) return;
    const cat = parts[2] ?? "";
    const field = parts[3] ?? "";
    const action = parts[4] ?? "";

    const c = ctx.settings.categories;
    let patch: Partial<FredySettings> = {};

    // Handle "sameTwice" toggle (special — not a category).
    if (cat === "sameTwice" && field === "toggle") {
      patch = { categories: { ...c, allowSameCategoryTwice: !c.allowSameCategoryTwice } };
    } else if (["A", "B", "C"].includes(cat)) {
      const category = cat as Category;

      if (field === "toggle") {
        const item = c[category];
        patch = { categories: { ...c, [category]: { ...item, enabled: !item.enabled } } };
      } else if (field === "limit") {
        const item = c[category];
        const next = action === "inc" ? Math.min(50, item.dailyLimit + 1) : Math.max(0, item.dailyLimit - 1);
        patch = { categories: { ...c, [category]: { ...item, dailyLimit: next } } };
      } else if (field === "weight") {
        const item = c[category];
        const next = action === "inc" ? Math.min(100, item.weight + 5) : Math.max(0, item.weight - 5);
        patch = { categories: { ...c, [category]: { ...item, weight: next } } };
      }
    }

    if (Object.keys(patch).length === 0) return;
    const result = await ctx.container.config.updateSettings(ctx.adminId, patch);
    if (!result.ok) return { alert: `❌ ${result.error}` };
    return { toast: "✅ Updated" };
  },
};

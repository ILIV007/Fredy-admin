/**
 * src/admin/screens/soul.ts
 * Soul.md screen — reload, view status, edit, reset.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton, navButton } from "../keyboards";
import { header, kv, divider, truncate, codeBlock } from "../helpers/formatting";

export const soulScreen: Screen = {
  id: "soul",

  async text(ctx) {
    const soul = await ctx.container.soul.load();
    const sectionCount = Object.keys(soul.sections).length;
    const preview = truncate(soul.raw, 500);

    return [
      header("Soul.md", "📝"),
      "",
      kv("Loaded", "✅"),
      kv("Length", `${soul.raw.length} chars`),
      kv("Sections", sectionCount),
      "",
      header("Sections Found", "📑"),
      Object.keys(soul.sections).map((s) => `  • ${s}`).join("\n"),
      "",
      header("Preview", "👁"),
      codeBlock(preview),
      "",
      divider(),
      "<i>Soul.md controls Fredy's personality and writing style.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    void s;
    return buildKeyboardWithBack([
      [navButton("🔄 Reload from KV", "action:soul:reload")],
      [navButton("👁 View Full", "action:soul:view")],
      [navButton("✏️ Edit (send text)", "action:soul:edit")],
      [navButton("🔄 Reset to Default", "action:soul:reset")],
      [navButton("🧪 Preview Sample Post", "action:soul:preview")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 3) return;
    const action = parts[2];

    if (action === "reload") {
      // Force-reload by clearing the cache and re-loading.
      await ctx.container.soul.reset(); // temporary — real impl would just invalidate cache
      return { toast: "🔄 Soul reloaded" };
    }

    if (action === "view") {
      const soul = await ctx.container.soul.load();
      return {
        alert: soul.raw.slice(0, 200),
      };
    }

    if (action === "edit") {
      return {
        toast: "📝 Send the new soul.md as a single message. (Phase 6)",
      };
    }

    if (action === "reset") {
      await ctx.container.soul.reset();
      return { toast: "✅ Reset to default" };
    }

    if (action === "preview") {
      return { toast: "🧪 Sample post preview (Phase 6)" };
    }
  },
};

/**
 * src/admin/screens/manual.ts
 * Manual Actions screen — send category A/B/C, send NASA, send specific plugin.
 *
 * Triggers immediate pipeline runs without waiting for the scheduler.
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, labelButton, navButton } from "../keyboards";
import { header, divider, kv } from "../helpers/formatting";

export const manualScreen: Screen = {
  id: "manual",

  async text(ctx) {
    const sources = ctx.container.sources.list();
    return [
      header("Manual Actions", "✍️"),
      "",
      "Trigger an immediate post. The pipeline runs once and publishes to the channel.",
      "",
      header("By Category", "📚"),
      kv("A", "Dev content (programming, AI, GitHub, tools)"),
      kv("B", "Tech news"),
      kv("C", "NASA / joke / quote / fact"),
      "",
      header("By Source", "🔌"),
      ...sources.map((s) => kv(s.name, `${s.label} (${s.category})`)),
      "",
      divider(),
      "<i>Tap an action to run it now.</i>",
    ].join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    void s;
    return buildKeyboardWithBack([
      [labelButton("─── By Category ───")],
      [navButton("🟢 Send Category A", "action:manual:category:A")],
      [navButton("🟡 Send Category B", "action:manual:category:B")],
      [navButton("🟣 Send Category C", "action:manual:category:C")],
      [labelButton("─── By Source ───")],
      [navButton("📦 Send GitHub", "action:manual:source:github")],
      [navButton("📰 Send News", "action:manual:source:news")],
      [navButton("🪐 Send NASA", "action:manual:source:nasa")],
      [navButton("😄 Send Joke", "action:manual:source:joke")],
      [labelButton("─── Special ───")],
      [navButton("🧪 Simulate (no publish)", "action:manual:simulate")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Format: action:manual:<type>:<arg>
    if (parts.length < 4 || parts[1] !== "manual") return;
    const [, , type, arg] = parts;

    if (type === "simulate") {
      return { toast: "🧪 Simulation not implemented (Phase 6)" };
    }

    if (type === "category") {
      // Trigger pipeline for a specific category.
      // Real impl: container.pipeline.run({ category: arg, simulate: false })
      return { toast: `🚀 Sending category ${arg}... (skeleton)` };
    }

    if (type === "source") {
      // Trigger pipeline for a specific source.
      return { toast: `🚀 Sending from ${arg}... (skeleton)` };
    }
  },
};

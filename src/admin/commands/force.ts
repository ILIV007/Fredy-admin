/**
 * src/admin/commands/force.ts
 * v11.3.0: /force command — force publish now (with confirmation).
 */

import type { Command, CommandContext } from "../registry";
import { escapeHtml } from "../../primitives/strings";

export const forceCommand: Command = {
  name: "/force",
  description: "Force publish now (runs scheduler tick immediately)",

  async handle(ctx: CommandContext): Promise<void> {
    try {
      await ctx.reply(`<b>⚡ Force publishing...</b>`);

      const result = await ctx.container.scheduler.tick();

      if (result.fired) {
        const slot = result.slot;
        const html = [
          `<b>━━━ ✅ PUBLISHED ━━━</b>`,
          ``,
          `<blockquote>📅 Slot: #${slot?.index ?? "?"} at ${slot?.time ?? "?"}</blockquote>`,
          `<blockquote>📂 Category: ${slot?.category ?? "?"}</blockquote>`,
          `<blockquote>⏰ Time: ${new Date().toISOString()}</blockquote>`,
        ].join("\n");
        await ctx.reply(html);
      } else {
        const html = [
          `<b>━━━ ⚠️ No Publish ━━━</b>`,
          ``,
          `<blockquote>📋 Reason: ${escapeHtml(result.skipReason ?? "No due slots")}</blockquote>`,
        ].join("\n");
        await ctx.reply(html);
      }
    } catch (error) {
      await ctx.reply(`❌ Force publish failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  },
};

/**
 * src/admin/commands/force.ts
 * v11.3.0: /force command — force publish now.
 * v11.4.0: CRITICAL FIX — previously called scheduler.tick() which fires ALL
 *          due slots. Now generates ONE fresh post and publishes it, WITHOUT
 *          touching the scheduler. This prevents the "double publish" bug
 *          where manual force caused scheduled slots to fire simultaneously.
 */

import type { Command, CommandContext } from "../registry";
import { escapeHtml } from "../../primitives/strings";

export const forceCommand: Command = {
  name: "/force",
  description: "Force publish ONE post now (does not affect scheduler)",

  async handle(ctx: CommandContext): Promise<void> {
    try {
      await ctx.reply(`<b>⚡ Generating a fresh post...</b>`);

      const settings = await ctx.container.config.getSettings(ctx.adminId);
      const lang = settings.language.default;

      // v11.4.0: Generate ONE post from category A (most content available).
      // This does NOT call scheduler.tick() so it won't fire scheduled slots.
      const result = await ctx.container.content.processForCategory(
        "A",
        null,
        lang,
        { skipEnqueue: true },
      );

      if (!result.ok || !result.content) {
        await ctx.reply(`❌ No content available: ${escapeHtml(result.error ?? "unknown")}`);
        return;
      }

      const pubResult = await ctx.container.finalPublisher.publish(result.content);
      if (pubResult.ok) {
        await ctx.container.duplicateDetector.recordPublished(result.content).catch(() => {});
        const html = [
          `<b>━━━ ✅ PUBLISHED ━━━</b>`,
          ``,
          `<blockquote>📂 Category: ${result.content.category}</blockquote>`,
          `<blockquote>🔌 Source: ${escapeHtml(result.content.pluginId)}</blockquote>`,
          `<blockquote>🤖 AI: ${result.content.aiProvider}/${result.content.aiModel}</blockquote>`,
          `<blockquote>📊 Quality: ${result.content.quality.overallScore}</blockquote>`,
          `<blockquote>📤 Message ID: ${pubResult.telegramMessageId}</blockquote>`,
          `<blockquote>⏰ Time: ${new Date().toISOString()}</blockquote>`,
        ].join("\n");
        await ctx.reply(html);
      } else {
        await ctx.reply(`❌ Publish failed: ${escapeHtml(pubResult.error ?? "unknown")}`);
      }
    } catch (error) {
      await ctx.reply(`❌ Force publish failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  },
};

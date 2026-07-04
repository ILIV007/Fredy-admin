/**
 * src/admin/commands/stats.ts
 * /stats command — quick stats summary.
 */

import type { Command, CommandContext } from "../registry";
import { formatNumber, formatRelativeTime } from "../helpers/formatting";

export const statsCommand: Command = {
  name: "/stats",
  description: "Show global statistics",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, reply } = ctx;
    const global = await container.kv.getGlobalStats();
    const state = await container.config.getState(adminId);

    const lines = [
      "<b>📊 Fredy Stats</b>",
      "",
      "<b>Global:</b>",
      `  Processed: ${formatNumber(global.processed)}`,
      `  Published: ${formatNumber(global.published)}`,
      `  Rejected: ${formatNumber(global.rejected)}`,
      `  Failed: ${formatNumber(global.failed)}`,
      "",
      "<b>Today:</b>",
      `  Date: ${state.today.date}`,
      `  Slots fired: ${state.today.slotsFired.length}`,
      `  A: ${state.today.categoriesPublished.A} | B: ${state.today.categoriesPublished.B} | C: ${state.today.categoriesPublished.C}`,
      "",
      "<b>Last:</b>",
      `  Published: ${formatRelativeTime(state.lastPublishedAt)}`,
      `  Source: ${state.lastSource ?? "(none)"}`,
      `  Category: ${state.lastCategory ?? "(none)"}`,
    ];
    await reply(lines.join("\n"));
  },
};

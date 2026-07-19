/**
 * src/admin/commands/providers.ts
 * v11.3.0: /providers command — quick provider health overview.
 */

import type { Command, CommandContext } from "../registry";
import { escapeHtml } from "../../primitives/strings";
import { PROVIDERS_CONFIG } from "../../core/providers.config";

export const providersCommand: Command = {
  name: "/providers",
  description: "Quick provider health overview (which are empty/healthy)",

  async handle(ctx: CommandContext): Promise<void> {
    const statuses = ctx.container.plugins.getAllStatuses();
    const statusMap = new Map(statuses.map((s) => [s.pluginId, s]));

    const enabled = PROVIDERS_CONFIG.filter((p) => {
      const status = statusMap.get(p.id);
      return status?.enabled ?? p.enabledByDefault;
    });

    const empty = enabled.filter((p) => {
      const status = statusMap.get(p.id);
      return status?.lastItemCount === 0;
    });

    const healthy = enabled.filter((p) => {
      const status = statusMap.get(p.id);
      return status?.healthy !== false;
    });

    let html = `<b>━━━ 🔌 Provider Health ━━━</b>\n\n`;
    html += `<blockquote>🟢 Enabled: ${enabled.length}/${PROVIDERS_CONFIG.length}</blockquote>`;
    html += `<blockquote>💚 Healthy: ${healthy.length}/${enabled.length}</blockquote>`;
    html += `<blockquote>📦 Empty: ${empty.length}/${enabled.length}</blockquote>\n`;

    if (empty.length > 0) {
      html += `<b>⚠️ Empty Providers:</b>\n`;
      for (const p of empty) {
        const status = statusMap.get(p.id);
        const lastError = status?.lastErrorMessage ?? "no error";
        html += `<blockquote>🔴 ${escapeHtml(p.name)} — ${escapeHtml(lastError).slice(0, 80)}</blockquote>\n`;
      }
    } else {
      html += `<b>✅ All enabled providers have content.</b>\n`;
    }

    html += `\n<i>💡 Use /menu → Providers for management.</i>`;

    await ctx.reply(html);
  },
};

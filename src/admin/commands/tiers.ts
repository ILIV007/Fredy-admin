/**
 * src/admin/commands/tiers.ts
 * v11.3.0: /tiers command — shows all providers grouped by tier.
 */

import type { Command, CommandContext } from "../registry";
import { escapeHtml } from "../../primitives/strings";
import { PROVIDERS_CONFIG, getProviderWeight } from "../../core/providers.config";
import type { Tier } from "../../types/tier";

export const tiersCommand: Command = {
  name: "/tiers",
  description: "View all providers grouped by tier (S/A/B/Legacy)",

  async handle(ctx: CommandContext): Promise<void> {
    const statuses = ctx.container.plugins.getAllStatuses();
    const statusMap = new Map(statuses.map((s) => [s.pluginId, s]));

    const tiers: readonly Tier[] = ["S", "A", "B", "legacy"];
    const tierEmojis: Record<Tier, string> = { S: "🥇", A: "🥈", B: "🥉", legacy: "📦" };
    const tierNames: Record<Tier, string> = {
      S: "Tier S (Core · 2h)",
      A: "Tier A (Important · 6h)",
      B: "Tier B (Supporting · 12h)",
      legacy: "Legacy (Disabled · 24h)",
    };

    let html = `<b>━━━ 📊 Provider Tiers ━━━</b>\n\n`;

    for (const tier of tiers) {
      const providers = PROVIDERS_CONFIG.filter((p) => p.tier === tier);
      if (providers.length === 0) continue;

      const enabledCount = providers.filter((p) => {
        const status = statusMap.get(p.id);
        return status?.enabled ?? p.enabledByDefault;
      }).length;

      html += `<b>${tierEmojis[tier]} ${tierNames[tier]}</b>\n`;
      html += `<blockquote>${enabledCount}/${providers.length} enabled</blockquote>\n`;

      for (const p of providers) {
        const status = statusMap.get(p.id);
        const isEnabled = status?.enabled ?? p.enabledByDefault;
        const isHealthy = status?.healthy ?? true;
        const lastItems = status?.lastItemCount ?? null;
        const weight = getProviderWeight(p.id);

        const statusIcon = isEnabled ? (isHealthy ? "🟢" : "🟡") : "🔴";
        const itemsStr = lastItems !== null ? ` | 📦${lastItems}` : "";

        html += `<blockquote>${statusIcon} <b>${escapeHtml(p.name)}</b> [w:${weight}]${itemsStr}</blockquote>\n`;
      }
      html += `\n`;
    }

    html += `<i>💡 Use /menu → Tiers for management.</i>`;

    await ctx.reply(html);
  },
};

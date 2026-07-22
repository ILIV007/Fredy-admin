/**
 * src/admin/screens/tiers.ts
 * v11.3.0: Provider Tier Management screen.
 *
 * Shows all 20 providers grouped by tier (S/A/B/Legacy) with:
 *   - Enabled/disabled status
 *   - Weight (configurable)
 *   - Health (last fetch result)
 *   - Last item count
 *
 * Allows:
 *   - Enable/disable providers
 *   - Increase/decrease weight
 *   - Test individual providers
 */

import type { Screen, ScreenAction } from "../registry";
import type { ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { escapeHtml } from "../../primitives/strings";
import { PROVIDERS_CONFIG, getProviderWeight } from "../../core/providers.config";
import { buildKeyboard } from "../keyboards";
import type { Tier } from "../../types/tier";

export const tiersScreen: Screen = {
  id: "tiers",

  async text(ctx: ScreenContext): Promise<string> {
    const statuses = ctx.container.plugins.getAllStatuses();
    const statusMap = new Map(statuses.map((s) => [s.pluginId, s]));

    const tiers: readonly Tier[] = ["S", "A", "B", "legacy", "V"];
    const tierEmojis: Record<Tier, string> = { S: "🥇", A: "🥈", B: "🥉", legacy: "📦", V: "🟣" };
    const tierNames: Record<Tier, string> = { S: "Tier S (Core)", A: "Tier A (Important)", B: "Tier B (Supporting)", legacy: "Legacy (Disabled)", V: "Tier V (Scheduled)" };

    let html = `<b>━━━ 📊 Provider Tiers ━━━</b>\n\n`;

    for (const tier of tiers) {
      const providers = PROVIDERS_CONFIG.filter((p) => p.tier === tier);
      if (providers.length === 0) continue;

      const enabledCount = providers.filter((p) => {
        const status = statusMap.get(p.id);
        return status?.enabled ?? p.enabledByDefault;
      }).length;

      html += `<b>${tierEmojis[tier]} ${tierNames[tier]}</b>\n`;
      html += `<blockquote>📋 ${enabledCount}/${providers.length} enabled | 🔄 every ${getTierRefreshHours(tier)}h</blockquote>\n`;

      for (const p of providers) {
        const status = statusMap.get(p.id);
        const isEnabled = status?.enabled ?? p.enabledByDefault;
        const isHealthy = status?.healthy ?? true;
        const lastItems = status?.lastItemCount ?? null;
        const weight = getProviderWeight(p.id);

        const statusIcon = isEnabled ? (isHealthy ? "🟢" : "🟡") : "🔴";
        const itemsStr = lastItems !== null ? ` | 📦 ${lastItems} items` : "";

        html += `<blockquote>${statusIcon} <b>${escapeHtml(p.name)}</b> [${weight}]${itemsStr}</blockquote>\n`;
      }
      html += `\n`;
    }

    html += `<i>💡 Tap a provider to manage it (enable/disable, weight, test).</i>`;
    return html;
  },

  keyboard(_settings: FredySettings, ctx?: ScreenContext): InlineKeyboard {
    const statuses = ctx?.container.plugins.getAllStatuses() ?? [];
    const statusMap = new Map(statuses.map((s) => [s.pluginId, s]));

    const rows: { text: string; callback_data: string }[][] = [];
    const tiers: readonly Tier[] = ["S", "A", "B", "legacy"];

    for (const tier of tiers) {
      const providers = PROVIDERS_CONFIG.filter((p) => p.tier === tier);
      if (providers.length === 0) continue;

      // Tier header row
      rows.push([{
        text: `── ${tier} Tier ──`,
        callback_data: "ignore",
      }]);

      // Provider buttons (2 per row)
      for (let i = 0; i < providers.length; i += 2) {
        const row: { text: string; callback_data: string }[] = [];
        for (let j = i; j < Math.min(i + 2, providers.length); j++) {
          const p = providers[j]!;
          const status = statusMap.get(p.id);
          const isEnabled = status?.enabled ?? p.enabledByDefault;
          const icon = isEnabled ? "🟢" : "🔴";
          const weight = getProviderWeight(p.id);
          row.push({
            text: `${icon} ${p.name} [${weight}]`,
            callback_data: `tier:manage:${p.id}`,
          });
        }
        rows.push(row);
      }
    }

    rows.push([{ text: "🔙 Back to Menu", callback_data: "menu:main" }]);
    return buildKeyboard(rows);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    const action = parts[1];

    if (action === "manage" && parts[2]) {
      const providerId = parts[2];
      const plugin = ctx.container.plugins.get(providerId);
      if (!plugin) {
        return { toast: `Provider "${providerId}" not found` };
      }
      const status = ctx.container.plugins.getStatus(providerId);
      const isEnabled = status.enabled;
      const weight = getProviderWeight(providerId);

      const newText = [
        `<b>━━━ 🔧 ${escapeHtml(plugin.metadata.name)} ━━━</b>`,
        ``,
        `<blockquote>🆔 <b>ID:</b> ${providerId}</blockquote>`,
        `<blockquote>📊 <b>Tier:</b> ${plugin.getTier().toUpperCase()}</blockquote>`,
        `<blockquote>📂 <b>Category:</b> ${plugin.getCategory()}</blockquote>`,
        `<blockquote>⚖️ <b>Weight:</b> ${weight}</blockquote>`,
        `<blockquote> Status: ${isEnabled ? "🟢 Enabled" : "🔴 Disabled"}</blockquote>`,
        `<blockquote>💚 <b>Health:</b> ${status.healthy ? "Healthy" : "Unhealthy"}</blockquote>`,
        `<blockquote>📦 <b>Last Items:</b> ${status.lastItemCount ?? "—"}</blockquote>`,
        `<blockquote>🔄 <b>Refresh:</b> ${getTierRefreshHours(plugin.getTier())}h</blockquote>`,
      ].join("\n");

      const newKeyboard = { inline_keyboard: [
        [
          { text: isEnabled ? "🔴 Disable" : "🟢 Enable", callback_data: `tier:toggle:${providerId}` },
          { text: "🧪 Test", callback_data: `tier:test:${providerId}` },
        ],
        [
          { text: "➖ Weight", callback_data: `tier:weight:${providerId}:dec` },
          { text: `[${weight}]`, callback_data: "ignore" },
          { text: "➕ Weight", callback_data: `tier:weight:${providerId}:inc` },
        ],
        [
          { text: "🔄 Force Refresh", callback_data: `tier:refresh:${providerId}` },
        ],
        [{ text: "🔙 Back to Tiers", callback_data: "menu:tiers" }],
      ] };

      return { newText, newKeyboard };
    }

    if (action === "toggle" && parts[2]) {
      const providerId = parts[2];
      const status = ctx.container.plugins.getStatus(providerId);
      if (status.enabled) {
        ctx.container.plugins.disable(providerId);
        return { toast: `🔴 ${providerId} disabled`, redirectTo: "tiers" };
      } else {
        ctx.container.plugins.enable(providerId);
        return { toast: `🟢 ${providerId} enabled`, redirectTo: "tiers" };
      }
    }

    if (action === "test" && parts[2]) {
      const providerId = parts[2];
      try {
        const items = await ctx.container.plugins.fetchFrom(providerId);
        return { toast: `🧪 ${providerId}: ${items.length} items` };
      } catch (error) {
        return { alert: `❌ ${providerId}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (action === "refresh" && parts[2]) {
      const providerId = parts[2];
      try {
        const items = await ctx.container.plugins.fetchFrom(providerId);
        return { toast: `🔄 ${providerId}: refreshed ${items.length} items` };
      } catch (error) {
        return { alert: `❌ ${providerId}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (action === "weight" && parts[2] && parts[3]) {
      // v11.3.0: Weight management requires updating the tiers config section.
      // This is a placeholder — full weight editing is available via the dashboard.
      return { toast: `⚖️ Weight management requires dashboard (coming soon)` };
    }

    return void 0;
  },
};

function getTierRefreshHours(tier: Tier): number {
  switch (tier) {
    case "S": return 2;
    case "A": return 6;
    case "B": return 12;
    case "legacy": return 24;
    case "V": return 0; // on-demand fetch, no refresh interval
  }
}

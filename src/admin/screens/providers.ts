/**
 * src/admin/screens/providers.ts
 * Providers screen — list all plugins, enable/disable, priority, manual test.
 *
 * Now uses PluginManager (content sources) and ProviderRegistry (AI providers).
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, labelButton, navButton } from "../keyboards";
import { header, kv, statusBadge, divider, yesNo } from "../helpers/formatting";

export const providersScreen: Screen = {
  id: "providers",

  async text(ctx) {
    const plugins = ctx.container.plugins.list();
    const pluginStatuses = ctx.container.plugins.getAllStatuses();
    const providers = ctx.container.providers.listWithStatus();

    const lines = [
      header("Providers", "🔌"),
      "",
      header("Content Source Plugins", "📡"),
      "",
    ];

    for (const plugin of plugins) {
      const status = pluginStatuses.find((s) => s.pluginId === plugin.metadata.id);
      const healthy = status?.healthy ? "✅" : "❌";
      const enabled = ctx.container.plugins.isEnabled(plugin.metadata.id) ? "ON" : "OFF";
      lines.push(
        `<b>${plugin.metadata.name}</b> (${plugin.metadata.id}) ${healthy}`,
        kv("Category", plugin.metadata.category),
        kv("Enabled", enabled),
        kv("Priority", plugin.metadata.priority),
        kv("Rate limit", `${plugin.metadata.rateLimit}/hr`),
        kv("Images", yesNo(plugin.metadata.supportsImages)),
        kv("Fetches", `${status?.totalFetches ?? 0} (${status?.totalSuccesses ?? 0} ok, ${status?.totalFailures ?? 0} fail)`),
        "",
      );
    }

    lines.push(
      header("AI Providers", "🤖"),
      "",
    );

    for (const provider of providers) {
      const configured = provider.configured ? "✅" : "❌";
      const enabled = provider.enabled ? "ON" : "OFF";
      lines.push(
        `<b>${provider.name}</b> (${provider.id}) ${configured}`,
        kv("Enabled", enabled),
        kv("Priority", provider.priority),
        kv("Models", provider.modelCount),
        "",
      );
    }

    lines.push(
      divider(),
      "<i>Tap to toggle or test a provider.</i>",
    );
    return lines.join("\n");
  },

  keyboard(s: FredySettings): InlineKeyboard {
    void s;
    return buildKeyboardWithBack([
      [labelButton("─── AI Providers ───")],
      [toggleButton("Gemini", true, "set:providers:gemini:toggle")],
      [toggleButton("OpenRouter", true, "set:providers:openrouter:toggle")],
      [labelButton("─── Source Plugins ───")],
      [toggleButton("GitHub", true, "set:plugins:github:toggle")],
      [toggleButton("News", true, "set:plugins:news:toggle")],
      [toggleButton("NASA", true, "set:plugins:nasa:toggle")],
      [toggleButton("Joke", true, "set:plugins:joke:toggle")],
      [labelButton("─── Manual Tests ───")],
      [navButton("🧪 Test Gemini", "action:test:gemini")],
      [navButton("🧪 Test OpenRouter", "action:test:openrouter")],
      [navButton("🧪 Test All Sources", "action:test:all-sources")],
      [navButton("🩺 Health Check All", "action:plugins:healthCheckAll")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    if (parts.length < 4) return;
    const [, scope, id, action] = parts;

    // Toggle AI providers.
    if (scope === "providers" && action === "toggle") {
      if (id === "gemini" || id === "openrouter") {
        const isEnabled = ctx.container.providers.isEnabled(id);
        if (isEnabled) {
          ctx.container.providers.disable(id);
        } else {
          ctx.container.providers.enable(id);
        }
        return { toast: `✅ ${id} ${isEnabled ? "disabled" : "enabled"}` };
      }
    }

    // Toggle content source plugins.
    if (scope === "plugins" && action === "toggle") {
      const isEnabled = ctx.container.plugins.isEnabled(id);
      if (isEnabled) {
        ctx.container.plugins.disable(id);
      } else {
        ctx.container.plugins.enable(id);
      }
      return { toast: `✅ ${id} ${isEnabled ? "disabled" : "enabled"}` };
    }

    // Health check all.
    if (scope === "plugins" && id === "healthCheckAll") {
      const statuses = await ctx.container.plugins.healthCheckAll();
      const healthy = statuses.filter((s) => s.healthy).length;
      return { toast: `🩺 ${healthy}/${statuses.length} plugins healthy` };
    }

    // Manual tests.
    if (scope === "test") {
      if (id === "gemini" || id === "openrouter") {
        return { toast: `🧪 Testing ${id}... (skeleton)` };
      }
      if (id === "all-sources") {
        const statuses = await ctx.container.plugins.healthCheckAll();
        return { toast: `🧪 Health check: ${statuses.filter((s) => s.healthy).length}/${statuses.length} ok` };
      }
    }
  },
};

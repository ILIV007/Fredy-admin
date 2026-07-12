/**
 * src/admin/screens/providers.ts
 * Providers screen — list all plugins, enable/disable, priority, manual test.
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
      [toggleButton("Dev.to", true, "set:plugins:devto:toggle")],
      [toggleButton("News", true, "set:plugins:news:toggle")],
      [toggleButton("NASA", true, "set:plugins:nasa:toggle")],
      [toggleButton("Joke", true, "set:plugins:joke:toggle")],
      [toggleButton("XKCD", true, "set:plugins:xkcd:toggle")],
      [toggleButton("HackerNews", true, "set:plugins:hackernews:toggle")],
      [toggleButton("Wikimedia", true, "set:plugins:wikimedia:toggle")],
      [labelButton("─── Manual Tests ───")],
      [navButton("🧪 Test Gemini", "action:providers:test:gemini")],
      [navButton("🧪 Test OpenRouter", "action:providers:test:openrouter")],
      [navButton("🧪 Test All Sources", "action:providers:test:all-sources")],
      [navButton("🩺 Health Check All", "action:providers:healthCheckAll")],
    ]);
  },

  async onCallback(data: string, ctx: ScreenContext): Promise<ScreenAction | void> {
    const parts = data.split(":");
    // Accept both 3-part and 4-part callbacks.
    // Format: "set:<scope>:<id>:<action>"  (4 parts)
    //      or "action:providers:<action>"  (3 parts)
    //      or "action:providers:<action>:<arg>"  (4 parts)
    if (parts.length < 3) return;

    const first = parts[0] ?? "";
    const second = parts[1] ?? "";
    const third = parts[2] ?? "";
    const fourth = parts[3] ?? "";

    // Handle "set:providers:<id>:toggle" and "set:plugins:<id>:toggle"
    if (first === "set") {
      const scope = second;
      const id = third;
      const action = fourth;

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
        if (!id) return { alert: "❌ Missing plugin ID" };
        const isEnabled = ctx.container.plugins.isEnabled(id);
        if (isEnabled) {
          ctx.container.plugins.disable(id);
        } else {
          ctx.container.plugins.enable(id);
        }
        return { toast: `✅ ${id} ${isEnabled ? "disabled" : "enabled"}` };
      }
    }

    // Handle "action:providers:<action>" or "action:providers:<action>:<arg>"
    if (first === "action" && second === "providers") {
      const action = third;

      // Health check all.
      if (action === "healthCheckAll") {
        const statuses = await ctx.container.plugins.healthCheckAll();
        const healthy = statuses.filter((s) => s.healthy).length;
        return { toast: `🩺 ${healthy}/${statuses.length} plugins healthy` };
      }

      // Test AI providers.
      if (action === "test") {
        const providerId = fourth;
        if (providerId === "gemini" || providerId === "openrouter") {
          // Run a quick AI test.
          try {
            const soul = await ctx.container.soul.load();
            const result = await ctx.container.ai.generate({
              category: "A",
              source: "test",
              raw: {
                id: "test",
                source: "test",
                category: "A" as const,
                title: "Test",
                body: "Hello world",
                url: "https://example.com",
                fetchedAt: Date.now(),
              },
              language: "en",
              soul,
            });
            if (result.ok) {
              return { toast: `✅ ${result.provider}/${result.model} (${result.tokensUsed} tokens)` };
            }
            return { alert: `❌ ${providerId}: ${result.error ?? "failed"}` };
          } catch (error) {
            return { alert: `❌ ${providerId}: ${error instanceof Error ? error.message : String(error)}` };
          }
        }
        if (providerId === "all-sources") {
          const statuses = await ctx.container.plugins.healthCheckAll();
          const healthy = statuses.filter((s) => s.healthy).length;
          return { toast: `🧪 Health check: ${healthy}/${statuses.length} ok` };
        }
      }
    }
  },
};

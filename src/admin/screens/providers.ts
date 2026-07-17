/**
 * src/admin/screens/providers.ts
 * Providers screen — list all plugins + AI providers, enable/disable, manual test.
 *
 * v7.4.0: The keyboard() function now accepts ctx so we can read the ACTUAL
 * plugin enabled-state from the PluginManager (the previous version always
 * showed "true" because it had no access to the runtime state).
 */

import type { Screen, ScreenAction, ScreenContext } from "../registry";
import type { FredySettings } from "../../types/config";
import type { InlineKeyboard, InlineKeyboardButton } from "../../types/telegram";
import { buildKeyboardWithBack, toggleButton, labelButton, navButton } from "../keyboards";
import { header, kv, divider, yesNo } from "../helpers/formatting";

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

  keyboard(s: FredySettings, ctx?: ScreenContext): InlineKeyboard {
    const rows: InlineKeyboardButton[][] = [];
    rows.push([labelButton("─── AI Providers ───")]);
    rows.push([toggleButton("Gemini", s.providers?.gemini?.enabled ?? true, "set:providers:gemini:toggle")]);
    rows.push([toggleButton("OpenRouter", s.providers?.openrouter?.enabled ?? true, "set:providers:openrouter:toggle")]);

    rows.push([labelButton("─── Source Plugins ───")]);
    // v7.4.0: Read actual plugin states from PluginManager when ctx is available.
    // Fallback to enabled=true (legacy behavior) when ctx is missing.
    if (ctx?.container?.plugins) {
      const plugins = ctx.container.plugins.list();
      for (const p of plugins) {
        const isEnabled = ctx.container.plugins.isEnabled(p.metadata.id);
        rows.push([toggleButton(p.metadata.name, isEnabled, `set:plugins:${p.metadata.id}:toggle`)]);
      }
    } else {
      // Legacy static fallback — used by /menu command before ctx is wired up.
      rows.push([toggleButton("GitHub", true, "set:plugins:github:toggle")]);
      rows.push([toggleButton("GitHub Trending", true, "set:plugins:github-trending:toggle")]);
      rows.push([toggleButton("GitHub Releases", true, "set:plugins:github-releases:toggle")]);
      rows.push([toggleButton("Dev.to", true, "set:plugins:devto:toggle")]);
      rows.push([toggleButton("Stack Exchange", true, "set:plugins:stackexchange:toggle")]);
      rows.push([toggleButton("News", true, "set:plugins:news:toggle")]);
      rows.push([toggleButton("HackerNews", true, "set:plugins:hackernews:toggle")]);
      rows.push([toggleButton("NASA", true, "set:plugins:nasa:toggle")]);
      rows.push([toggleButton("Joke", true, "set:plugins:joke:toggle")]);
      rows.push([toggleButton("XKCD", true, "set:plugins:xkcd:toggle")]);
      rows.push([toggleButton("Wikimedia", true, "set:plugins:wikimedia:toggle")]);
      rows.push([toggleButton("Reddit", true, "set:plugins:reddit:toggle")]);
    }

    rows.push([labelButton("─── Manual Tests ───")]);
    rows.push([navButton("🧪 Test Gemini", "action:providers:test:gemini")]);
    rows.push([navButton("🧪 Test OpenRouter", "action:providers:test:openrouter")]);
    rows.push([navButton("🧪 Test All Sources", "action:providers:test:all-sources")]);
    rows.push([navButton("🩺 Health Check All", "action:providers:healthCheckAll")]);
    return buildKeyboardWithBack(rows);
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
          const newEnabled = !isEnabled;
          // 1. Update in-memory state.
          if (newEnabled) {
            ctx.container.providers.enable(id);
          } else {
            ctx.container.providers.disable(id);
          }
          // 2. Persist to settings so other isolates (Manager dashboard, cron)
          //    and Worker restarts see the change.
          try {
            const cur = await ctx.container.config.getSettings(ctx.adminId);
            const curProviders = cur.providers ?? {};
            const curProviderCfg = (curProviders as unknown as Record<string, { enabled: boolean; models: string[]; timeoutMs: number; retryCount: number; dailyLimit: number; priority: number }>)[id];
            if (curProviderCfg) {
              await ctx.container.config.updateSettings(ctx.adminId, {
                providers: {
                  ...curProviders,
                  [id]: { ...curProviderCfg, enabled: newEnabled },
                },
              } as never);
            }
          } catch (e) {
            // Settings persistence failed — in-memory toggle still worked.
            console.warn("[providers] failed to persist toggle:", e);
          }
          return { toast: `✅ ${id} ${newEnabled ? "enabled" : "disabled"}` };
        }
      }

      // Toggle content source plugins.
      if (scope === "plugins" && action === "toggle") {
        if (!id) return { alert: "❌ Missing plugin ID" };
        const isEnabled = ctx.container.plugins.isEnabled(id);
        const newEnabled = !isEnabled;
        // 1. Update in-memory state.
        if (newEnabled) {
          ctx.container.plugins.enable(id);
        } else {
          ctx.container.plugins.disable(id);
        }
        // 2. Persist to settings.plugins.perPlugin[id].enabled so other
        //    isolates and Worker restarts see the change.
        try {
          const cur = await ctx.container.config.getSettings(ctx.adminId);
          const perPlugin = cur.plugins?.perPlugin ?? {};
          const curOverride = perPlugin[id as keyof typeof perPlugin] ?? {};
          await ctx.container.config.updateSettings(ctx.adminId, {
            plugins: {
              ...cur.plugins,
              perPlugin: {
                ...perPlugin,
                [id]: { ...curOverride, enabled: newEnabled },
              },
            },
          } as never);
        } catch (e) {
          console.warn("[plugins] failed to persist toggle:", e);
        }
        return { toast: `✅ ${id} ${newEnabled ? "enabled" : "disabled"}` };
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

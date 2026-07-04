/**
 * src/admin/commands/health.ts
 * /health command — quick system health check.
 */

import type { Command, CommandContext } from "../registry";

export const healthCommand: Command = {
  name: "/health",
  description: "System health check",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, reply } = ctx;
    const status = await container.debug.getStatus().catch(() => null);

    if (!status) {
      await reply("❌ Could not retrieve system status.");
      return;
    }

    const env = status.env as Readonly<Record<string, unknown>>;
    const lines = [
      "<b>🏥 System Health</b>",
      "",
      `Bot token: ${env.has_bot_token ? "✅" : "❌"}`,
      `KV binding: ${env.has_kv ? "✅" : "❌"}`,
      `Gemini key: ${env.has_gemini ? "✅" : "❌"}`,
      `OpenRouter key: ${env.has_openrouter ? "✅" : "❌"}`,
      `GitHub token: ${env.has_github ? "✅" : "❌"}`,
      `NewsAPI key: ${env.has_newsapi ? "✅" : "❌"}`,
      `NASA key: ${env.has_nasa ? "✅" : "❌"}`,
      "",
      `Debug mode: ${env.DEBUG_MODE}`,
      `Ring buffer: ${status.events} updates, ${status.errors} errors`,
    ];
    await reply(lines.join("\n"));
  },
};

/**
 * src/admin/commands/checkperms.ts
 * /checkperms command — check bot permissions in the target channel.
 */

import type { Command, CommandContext } from "../registry";
import { yesNo } from "../helpers/formatting";

export const checkPermsCommand: Command = {
  name: "/checkperms",
  description: "Check bot permissions in target channel",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, adminId, reply } = ctx;
    const settings = await container.config.getSettings(adminId);
    const channel = settings.telegram.targetChannel;
    const botId = await container.tg.getBotId();

    if (!botId) {
      await reply("❌ Could not determine bot ID. Is BOT_TOKEN set?");
      return;
    }

    const perms = await container.tg.checkSchedulingPermissions(channel, botId);

    const lines = perms.ok
      ? [
          "<b>✅ Permissions OK</b>",
          "",
          `📍 <b>Channel:</b> <code>${channel}</code>`,
          `👤 <b>Bot status:</b> <code>${perms.status}</code>`,
          `📮 <b>Can post:</b> ${yesNo(perms.canPostMessages)}`,
          "",
          "<i>Scheduling should work correctly.</i>",
        ]
      : [
          "<b>❌ Permission Issue</b>",
          "",
          `📍 <b>Channel:</b> <code>${channel}</code>`,
          `👤 <b>Bot status:</b> <code>${perms.status ?? "unknown"}</code>`,
          `📮 <b>Can post:</b> ${yesNo(perms.canPostMessages)}`,
          "",
          `<b>Error:</b> <code>${perms.error ?? "unknown"}</code>`,
          "",
          "<b>How to fix:</b>",
          "  1. Open the channel in Telegram",
          "  2. Go to <b>Channel Settings → Administrators</b>",
          "  3. Find the bot and tap it",
          "  4. Enable <b>Post Messages</b>",
          "  5. Run /checkperms again",
        ];
    await reply(lines.join("\n"));
  },
};

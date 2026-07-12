/**
 * src/admin/commands/soul.ts
 * /soul command — view soul.md status.
 */

import type { Command, CommandContext } from "../registry";
import { truncate, codeBlock } from "../helpers/formatting";

export const soulCommand: Command = {
  name: "/soul",
  description: "View soul.md status",

  async handle(ctx: CommandContext): Promise<void> {
    const { container, reply } = ctx;
    const soul = await container.soul.load();
    const sectionCount = Object.keys(soul.sections).length;

    const lines = [
      "<b>📝 Soul.md</b>",
      "",
      `Length: ${soul.raw.length} chars`,
      `Sections: ${sectionCount}`,
      "",
      "<b>Sections:</b>",
      ...Object.keys(soul.sections).map((s) => `  • ${s}`),
      "",
      "<b>Preview:</b>",
      codeBlock(truncate(soul.raw, 800)),
    ];
    await reply(lines.join("\n"));
  },
};

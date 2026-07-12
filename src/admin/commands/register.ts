/**
 * src/admin/commands/register.ts
 * Register all commands with a CommandRegistry instance.
 */

import type { CommandRegistry } from "../registry";
import {
  startCommand,
  helpCommand,
  statsCommand,
  checkPermsCommand,
  soulCommand,
  healthCommand,
  menuCommand,
} from "./index";

export function registerCommands(registry: CommandRegistry): void {
  registry.register(startCommand);
  registry.register(menuCommand);
  registry.register(helpCommand);
  registry.register(statsCommand);
  registry.register(checkPermsCommand);
  registry.register(soulCommand);
  registry.register(healthCommand);
}

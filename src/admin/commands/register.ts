/**
 * src/admin/commands/register.ts
 */
import type { CommandRegistry } from "../registry";
import {
  startCommand,
  menuCommand,
  helpCommand,
  statsCommand,
  checkPermsCommand,
  healthCommand,
} from "./index";

export function registerCommands(registry: CommandRegistry): void {
  registry.register(startCommand);
  registry.register(menuCommand);
  registry.register(helpCommand);
  registry.register(statsCommand);
  registry.register(checkPermsCommand);
  registry.register(healthCommand);
}

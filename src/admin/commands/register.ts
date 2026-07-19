/**
 * src/admin/commands/register.ts
 * Register all commands with a CommandRegistry instance.
 * v11.3.0: Added tiers, plan, debug, providers, force commands.
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
  tiersCommand,
  planCommand,
  debugCommand,
  providersCommand,
  forceCommand,
} from "./index";

export function registerCommands(registry: CommandRegistry): void {
  registry.register(startCommand);
  registry.register(menuCommand);
  registry.register(helpCommand);
  registry.register(statsCommand);
  registry.register(checkPermsCommand);
  registry.register(soulCommand);
  registry.register(healthCommand);
  // v11.3.0 new commands
  registry.register(tiersCommand);
  registry.register(planCommand);
  registry.register(debugCommand);
  registry.register(providersCommand);
  registry.register(forceCommand);
}

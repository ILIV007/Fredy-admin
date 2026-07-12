/**
 * src/admin/screens/register.ts
 * Register all screens with a ScreenRegistry instance.
 * Called from container.ts at startup.
 */

import type { ScreenRegistry } from "../registry";
import {
  mainScreen,
  settingsScreen,
  categoriesScreen,
  providersScreen,
  aiScreen,
  manualScreen,
  scheduleScreen,
  debugScreen,
  statsScreen,
} from "./index";

export function registerScreens(registry: ScreenRegistry): void {
  registry.register(mainScreen);
  registry.register(settingsScreen);
  registry.register(categoriesScreen);
  registry.register(providersScreen);
  registry.register(aiScreen);
  registry.register(manualScreen);
  registry.register(scheduleScreen);
  registry.register(debugScreen);
  registry.register(statsScreen);
}

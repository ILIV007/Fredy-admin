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
  strategyScreen,
  languageScreen,
  soulScreen,
  debugScreen,
  statsScreen,
  editorScreen,
} from "./index";

export function registerScreens(registry: ScreenRegistry): void {
  registry.register(mainScreen);
  registry.register(settingsScreen);
  registry.register(categoriesScreen);
  registry.register(providersScreen);
  registry.register(aiScreen);
  registry.register(manualScreen);
  registry.register(scheduleScreen);
  registry.register(strategyScreen);
  registry.register(languageScreen);
  registry.register(soulScreen);
  registry.register(debugScreen);
  registry.register(statsScreen);
  registry.register(editorScreen);
}

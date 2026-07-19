/**
 * src/admin/screens/register.ts
 * Register all screens with a ScreenRegistry instance.
 * Called from container.ts at startup.
 * v11.3.0: Added tiers, plan, schedulerdebug screens.
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
  soulScreen,
  debugScreen,
  statsScreen,
  editorScreen,
  languageScreen,
  strategyScreen,
  tiersScreen,
  planScreen,
  schedulerDebugScreen,
} from "./index";

export function registerScreens(registry: ScreenRegistry): void {
  registry.register(mainScreen);
  registry.register(settingsScreen);
  registry.register(categoriesScreen);
  registry.register(providersScreen);
  registry.register(aiScreen);
  registry.register(manualScreen);
  registry.register(scheduleScreen);
  registry.register(soulScreen);
  registry.register(debugScreen);
  registry.register(statsScreen);
  registry.register(editorScreen);
  registry.register(languageScreen);
  registry.register(strategyScreen);
  // v11.3.0 new screens
  registry.register(tiersScreen);
  registry.register(planScreen);
  registry.register(schedulerDebugScreen);
}

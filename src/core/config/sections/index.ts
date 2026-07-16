/**
 * src/core/config/sections/index.ts
 * Barrel export + registration function.
 *
 * To add a new config section:
 *   1. Create src/core/config/sections/my-section.ts
 *   2. Export the section object (key, version, schema, defaults, description)
 *   3. Import it here and add to registerAllSections()
 *   4. No other files need to change.
 */

import type { ConfigSectionRegistry } from "../section-registry";
import { generalSection } from "./general";
import { telegramSection } from "./telegram";
import { languageSection } from "./language";
import { schedulerSection } from "./scheduler";
import { categoriesSection } from "./categories";
import { aiSection } from "./ai";
import { providersSection } from "./providers";
import { contentSection } from "./content";
import { qualitySection } from "./quality";
import { debugSection } from "./debug";
import { loggingSection } from "./logging";
import { nasaSection } from "./nasa";
import { pluginsSection } from "./plugins";
import { futureSection } from "./future";
import { strategySection } from "./strategy";

// Re-export all section types and schemas for consumers.
export * from "./general";
export * from "./telegram";
export * from "./language";
export * from "./scheduler";
export * from "./categories";
export * from "./ai";
export * from "./providers";
export * from "./content";
export * from "./quality";
export * from "./debug";
export * from "./logging";
export * from "./nasa";
export * from "./plugins";
export * from "./future";
export * from "./strategy";

/**
 * Register all config sections with a ConfigSectionRegistry.
 * Called once at container construction.
 *
 * Order matters for the admin panel display (sections appear in this order).
 */
export function registerAllSections(registry: ConfigSectionRegistry): void {
  registry.register(generalSection);
  registry.register(telegramSection);
  registry.register(languageSection);
  registry.register(schedulerSection);
  registry.register(categoriesSection);
  registry.register(aiSection);
  registry.register(providersSection);
  registry.register(contentSection);
  registry.register(qualitySection);
  registry.register(debugSection);
  registry.register(loggingSection);
  registry.register(nasaSection);
  registry.register(pluginsSection);
  registry.register(futureSection);
  registry.register(strategySection);
}

/** List of all section keys in registration order. */
export const ALL_SECTION_KEYS = [
  "general",
  "telegram",
  "language",
  "scheduler",
  "categories",
  "ai",
  "providers",
  "content",
  "quality",
  "debug",
  "logging",
  "nasa",
  "plugins",
  "future",
  "strategy",
] as const;

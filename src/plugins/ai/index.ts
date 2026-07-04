/**
 * src/plugins/ai/index.ts
 * Barrel export for all AI provider plugins.
 *
 * TO ADD A NEW PROVIDER:
 *   1. Create src/plugins/ai/my-provider.ts (implementing AIProvider)
 *   2. Add import + export here
 *   3. Register in src/services/plugin-loader.ts
 */

export { GeminiProvider } from "./gemini";
export { OpenRouterProvider } from "./openrouter";

export type { AIProvider } from "../../types/plugin";

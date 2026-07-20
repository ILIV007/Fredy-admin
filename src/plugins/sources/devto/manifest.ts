/**
 * src/plugins/sources/devto/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const devtoManifest: PluginManifest = {
  id: "devto",
  name: "Dev.to",
  version: "1.0.0",
  enabled: true,
  category: "A",
  tier: "S",
  priority: 3,
  rateLimit: 1000,
  supportsImages: true,
  description: "Top articles from Dev.to developer community.",
  author: "Fredy",
  docsUrl: "https://developers.forem.com/api",
  homepage: "https://dev.to",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "💚",
  displaySource: "Dev.to",
  extractRepoFromUrl: false,
};

/**
 * src/plugins/sources/stackexchange/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const stackexchangeManifest: PluginManifest = {
  id: "stackexchange",
  name: "Stack Overflow",
  version: "1.1.0",
  enabled: true,
  category: "A",
  tier: "A",
  priority: 4,
  rateLimit: 300,
  supportsImages: true, // v12.2.0: Now extracts images from body HTML
  description: "Top questions from Stack Overflow and Stack Exchange.",
  author: "Fredy",
  docsUrl: "https://api.stackexchange.com/docs",
  homepage: "https://stackoverflow.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "📚",
  displaySource: "Stack Overflow",
  extractRepoFromUrl: false,
};

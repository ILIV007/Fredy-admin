/**
 * src/plugins/sources/stackexchange/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const stackexchangeManifest: PluginManifest = {
  id: "stackexchange",
  name: "Stack Exchange",
  version: "1.0.0",
  enabled: true,
  category: "A",
  tier: "A",
  priority: 4,
  rateLimit: 300,
  supportsImages: false,
  description: "Top questions from Stack Overflow and Stack Exchange.",
  author: "Fredy",
  docsUrl: "https://api.stackexchange.com/docs",
  homepage: "https://stackoverflow.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🧠",
  displaySource: "Stack Overflow",
  extractRepoFromUrl: false,
};

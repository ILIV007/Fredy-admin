/**
 * src/plugins/sources/github/manifest.ts
 * GitHub plugin metadata.
 */

import type { PluginManifest } from "../../../types/plugin";

export const githubManifest: PluginManifest = {
  id: "github",
  name: "GitHub Trending",
  version: "1.1.0",
  enabled: true,
  category: "A",
  tier: "S",
  priority: 1,
  rateLimit: 60,
  supportsImages: true,
  description: "Trending GitHub repositories and new releases.",
  author: "Fredy",
  docsUrl: "https://docs.github.com/en/rest/search",
  homepage: "https://github.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🐙",
  displaySource: null,
  extractRepoFromUrl: true,
};

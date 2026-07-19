/**
 * src/plugins/sources/github-trending/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const githubTrendingManifest: PluginManifest = {
  id: "github-trending",
  name: "GitHub Trending",
  version: "1.0.0",
  enabled: true,
  category: "C",
  tier: "S",
  priority: 4,
  rateLimit: 60,
  supportsImages: true,
  description: "Trending GitHub repositories (open source spotlight).",
  author: "Fredy",
  docsUrl: "https://docs.github.com/en/rest/search",
  homepage: "https://github.com/trending",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

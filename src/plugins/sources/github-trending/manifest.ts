/**
 * src/plugins/sources/github-trending/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const githubTrendingManifest: PluginManifest = {
  id: "github-trending",
  name: "GitHub Trending",
  version: "1.1.0",
  enabled: true,
  // v12.3.2: Was "C" — mismatched central config (providers.config.ts) and
  // CATEGORY_PROVIDERS (both said "A"). Now consistent: Cat A, same as the
  // other GitHub Tier S plugins (github, github-releases, github-events).
  // GitHub Trending is core developer content (open source discovery),
  // not "supporting/fun" content like Cat C (XKCD).
  category: "A",
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
  displayIcon: "🐙",
  displaySource: null,
  extractRepoFromUrl: true,
};

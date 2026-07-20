/**
 * src/plugins/sources/hackernews/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const hackernewsManifest: PluginManifest = {
  id: "hackernews",
  name: "Hacker News",
  version: "1.0.0",
  enabled: false,
  category: "B",
  tier: "legacy",
  priority: 2,
  rateLimit: 0,
  supportsImages: false,
  description: "Top stories from Hacker News (Y Combinator).",
  author: "Fredy",
  docsUrl: "https://github.com/HackerNews/API",
  homepage: "https://news.ycombinator.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "📰",
  displaySource: "Hacker News",
  extractRepoFromUrl: false,
};

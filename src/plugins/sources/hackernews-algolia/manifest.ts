/**
 * src/plugins/sources/hackernews-algolia/manifest.ts
 * Hacker News (Algolia) plugin — Tier S.
 * Uses the HN Algolia search API for better filtering and sorting.
 * https://hn.algolia.com/api
 */
import type { PluginManifest } from "../../../types/plugin";

export const hackernewsAlgoliaManifest: PluginManifest = {
  id: "hackernews-algolia",
  name: "Hacker News (Algolia)",
  version: "1.0.0",
  enabled: true,
  category: "B",
  tier: "S",
  priority: 1,
  rateLimit: 0,
  supportsImages: false,
  description: "Top Hacker News stories via Algolia search API (score >= 120, age <= 48h).",
  author: "Fredy",
  docsUrl: "https://hn.algolia.com/api",
  homepage: "https://news.ycombinator.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "📰",
  displaySource: "Hacker News",
  extractRepoFromUrl: false,
};

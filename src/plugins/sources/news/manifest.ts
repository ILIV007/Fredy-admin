/**
 * src/plugins/sources/news/manifest.ts
 * NewsAPI plugin metadata.
 */

import type { PluginManifest } from "../../../types/plugin";

export const newsManifest: PluginManifest = {
  id: "news",
  name: "Tech News (NewsAPI)",
  version: "1.1.0",
  enabled: true,
  category: "B",
  priority: 1,
  rateLimit: 100,
  supportsImages: true,
  description: "Technology news headlines from NewsAPI.org.",
  author: "Fredy",
  docsUrl: "https://newsapi.org/docs",
  homepage: "https://newsapi.org",
  supportsMarkdown: false,
  supportsLanguage: ["en"],
};

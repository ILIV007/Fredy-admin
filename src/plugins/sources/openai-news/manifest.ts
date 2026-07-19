/**
 * src/plugins/sources/openai-news/manifest.ts
 * OpenAI News RSS plugin — Tier B.
 * https://openai.com/news/rss.xml
 */
import type { PluginManifest } from "../../../types/plugin";

export const openaiNewsManifest: PluginManifest = {
  id: "openai-news",
  name: "OpenAI News",
  version: "1.0.0",
  enabled: true,
  category: "B",
  tier: "B",
  priority: 2,
  rateLimit: 0,
  supportsImages: false,
  description: "Latest announcements from OpenAI (models, research, policy).",
  author: "Fredy",
  docsUrl: "https://openai.com/news/rss.xml",
  homepage: "https://openai.com/news",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

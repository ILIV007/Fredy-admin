/**
 * src/plugins/sources/reddit/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const redditManifest: PluginManifest = {
  id: "reddit",
  name: "Reddit (Programming)",
  version: "1.0.0",
  enabled: false,
  category: "A",
  priority: 5,
  rateLimit: 60,
  supportsImages: true,
  description: "Top posts from programming-related subreddits. (Disabled: Reddit blocks server-side requests — needs OAuth migration.)",
  author: "Fredy",
  docsUrl: "https://www.reddit.com/dev/api",
  homepage: "https://www.reddit.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

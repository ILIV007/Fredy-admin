/**
 * src/plugins/sources/reddit-v2/manifest.ts
 * Reddit Programming plugin (v2) — Tier B.
 * https://www.reddit.com/r/programming/.json
 */
import type { PluginManifest } from "../../../types/plugin";

export const redditV2Manifest: PluginManifest = {
  id: "reddit-v2",
  name: "Reddit Programming",
  version: "1.0.0",
  enabled: true,
  category: "A",
  tier: "B",
  priority: 3,
  rateLimit: 60,
  supportsImages: false,
  description: "Top programming posts from Reddit (score >= 100, comments >= 20, not NSFW).",
  author: "Fredy",
  docsUrl: "https://www.reddit.com/r/programming/.json",
  homepage: "https://www.reddit.com/r/programming",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

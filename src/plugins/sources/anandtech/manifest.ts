/**
 * src/plugins/sources/anandtech/manifest.ts
 * v13.0.0: Tier H (Hardware & Technology Headlines) provider.
 */
import type { PluginManifest } from "../../../types/plugin";

export const anandtechManifest: PluginManifest = {
  id: "anandtech",
  name: "AnandTech",
  version: "1.0.0",
  enabled: true,
  category: "H",
  tier: "H",
  priority: 3,
  rateLimit: 0,
  supportsImages: true,
  description: "AnandTech — in-depth hardware analysis and reviews (RSS).",
  author: "Fredy",
  docsUrl: "https://feeds.feedburner.com/anandtech",
  homepage: "https://www.anandtech.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🔧",
  displaySource: "AnandTech",
  extractRepoFromUrl: false,
};

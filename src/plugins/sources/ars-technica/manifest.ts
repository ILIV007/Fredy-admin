/**
 * src/plugins/sources/ars-technica/manifest.ts
 * v13.0.0: Tier H (Hardware & Technology Headlines) provider.
 */
import type { PluginManifest } from "../../../types/plugin";

export const arsTechnicaManifest: PluginManifest = {
  id: "ars-technica",
  name: "Ars Technica",
  version: "1.0.0",
  enabled: true,
  category: "H",
  tier: "H",
  priority: 1,
  rateLimit: 0,
  supportsImages: true,
  description: "Ars Technica — technology, science, policy news (RSS).",
  author: "Fredy",
  docsUrl: "https://arstechnica.com/rss-feeds/",
  homepage: "https://arstechnica.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🔬",
  displaySource: "Ars Technica",
  extractRepoFromUrl: false,
};

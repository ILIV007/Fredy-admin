/**
 * src/plugins/sources/producthunt/manifest.ts
 * Product Hunt plugin — Tier A.
 * https://api.producthunt.com/
 */
import type { PluginManifest } from "../../../types/plugin";

export const producthuntManifest: PluginManifest = {
  id: "producthunt",
  name: "Product Hunt",
  version: "1.0.0",
  enabled: true,
  category: "B",
  tier: "A",
  priority: 3,
  rateLimit: 0,
  supportsImages: true,
  description: "Top developer tools, AI, and open-source products from Product Hunt.",
  author: "Fredy",
  docsUrl: "https://api.producthunt.com/",
  homepage: "https://www.producthunt.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🚀",
  displaySource: "Product Hunt",
  extractRepoFromUrl: false,
};

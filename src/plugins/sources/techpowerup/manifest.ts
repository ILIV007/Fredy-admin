/**
 * src/plugins/sources/techpowerup/manifest.ts
 * v13.0.4: Replaced AnandTech (RSS only returned forum spam) with TechPowerUp.
 * TechPowerUp has 111 RSS items with enclosure images — real hardware news.
 */
import type { PluginManifest } from "../../../types/plugin";

export const techpowerupManifest: PluginManifest = {
  id: "techpowerup",
  name: "TechPowerUp",
  version: "1.0.0",
  enabled: true,
  category: "H",
  tier: "H",
  priority: 3,
  rateLimit: 0,
  supportsImages: true,
  description: "TechPowerUp — hardware news, reviews, GPU/CPU/SSD launches (RSS with images).",
  author: "Fredy",
  docsUrl: "https://www.techpowerup.com/rss/news",
  homepage: "https://www.techpowerup.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "⚡",
  displaySource: "TechPowerUp",
  extractRepoFromUrl: false,
};

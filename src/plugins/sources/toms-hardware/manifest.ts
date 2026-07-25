/**
 * src/plugins/sources/toms-hardware/manifest.ts
 * v13.0.0: Tier H (Hardware & Technology Headlines) provider.
 */
import type { PluginManifest } from "../../../types/plugin";

export const tomsHardwareManifest: PluginManifest = {
  id: "toms-hardware",
  name: "Tom's Hardware",
  version: "1.0.0",
  enabled: true,
  category: "H",
  tier: "H",
  priority: 2,
  rateLimit: 0,
  supportsImages: true,
  description: "Tom's Hardware — PC hardware reviews, news, guides (RSS).",
  author: "Fredy",
  docsUrl: "https://www.tomshardware.com/feeds",
  homepage: "https://www.tomshardware.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🖥️",
  displaySource: "Tom's Hardware",
  extractRepoFromUrl: false,
};

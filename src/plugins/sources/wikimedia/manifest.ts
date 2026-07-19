/**
 * src/plugins/sources/wikimedia/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const wikimediaManifest: PluginManifest = {
  id: "wikimedia",
  name: "Today in Tech History",
  version: "1.0.0",
  enabled: false,
  category: "C",
  tier: "legacy",
  priority: 5,
  rateLimit: 200,
  supportsImages: true,
  description: "Today in tech history from Wikipedia/Wikimedia.",
  author: "Fredy",
  docsUrl: "https://en.wikipedia.org/api/rest_v1/",
  homepage: "https://www.wikipedia.org",
  supportsMarkdown: false,
  supportsLanguage: ["en"],
};

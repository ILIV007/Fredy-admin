/**
 * src/plugins/sources/nasa/manifest.ts
 * NASA APOD plugin metadata.
 */

import type { PluginManifest } from "../../../types/plugin";

export const nasaManifest: PluginManifest = {
  id: "nasa",
  name: "NASA APOD",
  version: "1.1.0",
  enabled: true,
  category: "C",
  priority: 1,
  rateLimit: 1000,
  supportsImages: true,
  description: "Astronomy Picture of the Day from NASA.",
  author: "Fredy",
  docsUrl: "https://api.nasa.gov/",
  homepage: "https://apod.nasa.gov",
  supportsMarkdown: false,
  supportsLanguage: ["en"],
};

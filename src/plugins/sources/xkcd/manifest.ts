/**
 * src/plugins/sources/xkcd/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const xkcdManifest: PluginManifest = {
  id: "xkcd",
  name: "XKCD",
  version: "1.0.0",
  enabled: true,
  category: "C",
  priority: 3,
  rateLimit: 0,
  supportsImages: true,
  description: "Latest XKCD comics for developers.",
  author: "Fredy",
  docsUrl: "https://xkcd.com/json.html",
  homepage: "https://xkcd.com",
  supportsMarkdown: false,
  supportsLanguage: ["en"],
};

/**
 * src/plugins/sources/github-releases/manifest.ts
 */
import type { PluginManifest } from "../../../types/plugin";

export const githubReleasesManifest: PluginManifest = {
  id: "github-releases",
  name: "GitHub Releases",
  version: "1.0.0",
  enabled: true,
  category: "A",
  priority: 2,
  rateLimit: 60,
  supportsImages: true,
  description: "Latest releases from popular open-source repositories.",
  author: "Fredy",
  docsUrl: "https://docs.github.com/en/rest/releases",
  homepage: "https://github.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

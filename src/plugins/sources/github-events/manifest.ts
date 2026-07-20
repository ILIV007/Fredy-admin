/**
 * src/plugins/sources/github-events/manifest.ts
 * v11.14.0: Refactored from "GitHub Events" to "GitHub Discovery".
 * No longer publishes raw events — discovers repositories from events,
 * validates quality, then feeds them into the pipeline as repo items.
 */

import type { PluginManifest } from "../../../types/plugin";

export const githubEventsManifest: PluginManifest = {
  id: "github-events",
  name: "GitHub Discovery",
  version: "2.0.0",
  enabled: true,
  category: "A",
  tier: "S",
  priority: 5,
  rateLimit: 60,
  supportsImages: false,
  description: "Discovers high-quality repositories from GitHub Events API. Validates stars, forks, and activity before feeding into pipeline.",
  author: "Fredy",
  docsUrl: "https://docs.github.com/en/rest/activity/events",
  homepage: "https://github.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🐙",
  displaySource: null,
  extractRepoFromUrl: true,
};

/**
 * src/plugins/sources/github-events/manifest.ts
 * GitHub Events plugin — Tier S.
 * Fetches recent public events from the GitHub Activity API.
 * https://docs.github.com/en/rest/activity/events
 */
import type { PluginManifest } from "../../../types/plugin";

export const githubEventsManifest: PluginManifest = {
  id: "github-events",
  name: "GitHub Events",
  version: "1.0.0",
  enabled: true,
  category: "A",
  tier: "S",
  priority: 3,
  rateLimit: 60,
  supportsImages: false,
  description: "Recent public events from popular GitHub repositories (releases, pushes, watches).",
  author: "Fredy",
  docsUrl: "https://docs.github.com/en/rest/activity/events",
  homepage: "https://github.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

/**
 * src/plugins/sources/night-music/manifest.ts
 * v13.2.0: Night Music plugin — Tier V, Zero-API RSS.
 *
 * Publishes one legendary song per night after NASA APOD.
 * Uses Last.fm RSS (no API key required).
 * 10-stage quality pipeline ensures only Hall-of-Fame songs are published.
 */

import type { PluginManifest } from "../../../types/plugin";

export const nightMusicManifest: PluginManifest = {
  id: "night-music",
  name: "Night Music",
  version: "1.0.0",
  enabled: true,
  category: "C", // kept for backward compat — Tier V scheduling overrides
  tier: "V", // v12.0.9: Tier V (scheduled content, after NASA)
  priority: 2, // after NASA (priority 1)
  rateLimit: 0, // RSS — no rate limit
  supportsImages: false, // minimal text-only post
  description: "Nightly legendary song after NASA APOD. Zero-API RSS, 10-stage quality pipeline, Hall of Fame curated list.",
  author: "Fredy",
  docsUrl: "https://www.last.fm/music",
  homepage: "https://www.last.fm",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🎵",
  displaySource: "Night Music",
  extractRepoFromUrl: false,
};

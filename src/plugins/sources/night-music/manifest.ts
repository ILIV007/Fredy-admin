/**
 * src/plugins/sources/night-music/manifest.ts
 * v13.3.0: Night Music plugin — Tier V, Jamendo API.
 *
 * Publishes one Creative Commons audio track per night after NASA APOD.
 * Uses Jamendo Official API (JAMENDO_CLIENT_ID from Worker Secret).
 * Audio is sent via Telegram sendAudio() — native playback in Telegram.
 */

import type { PluginManifest } from "../../../types/plugin";

export const nightMusicManifest: PluginManifest = {
  id: "night-music",
  name: "Night Music",
  version: "2.0.0",
  enabled: true,
  category: "C",
  tier: "V",
  priority: 2,
  rateLimit: 0,
  supportsImages: false,
  description: "Nightly CC audio track from Jamendo API. sendAudio() native playback.",
  author: "Fredy",
  docsUrl: "https://developer.jamendo.com/v3.0",
  homepage: "https://www.jamendo.com",
  supportsMarkdown: false,
  supportsLanguage: ["en"],
  displayIcon: "🎵",
  displaySource: "Night Music",
  extractRepoFromUrl: false,
};

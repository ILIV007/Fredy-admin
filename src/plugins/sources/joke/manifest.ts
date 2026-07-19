/**
 * src/plugins/sources/joke/manifest.ts
 * JokeAPI plugin metadata.
 */

import type { PluginManifest } from "../../../types/plugin";

export const jokeManifest: PluginManifest = {
  id: "joke",
  name: "Dev Jokes (JokeAPI)",
  version: "1.1.0",
  enabled: false,
  category: "C",
  tier: "legacy",
  priority: 2,
  rateLimit: 120,
  supportsImages: false,
  description: "Programming jokes from JokeAPI v2.",
  author: "Fredy",
  docsUrl: "https://v2.jokeapi.dev/",
  homepage: "https://v2.jokeapi.dev",
  supportsMarkdown: false,
  supportsLanguage: ["en"],
};

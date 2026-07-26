/**
 * src/plugins/sources/anandtech/manifest.ts
 * v13.0.4: DISABLED — AnandTech RSS only returns forum marketplace spam.
 * Kept as legacy for potential future re-enablement if AnandTech restores
 * their article RSS feed. Admin can enable from Manager if desired.
 */
import type { PluginManifest } from "../../../types/plugin";

export const anandtechManifest: PluginManifest = {
  id: "anandtech",
  name: "AnandTech (legacy)",
  version: "1.1.0",
  enabled: false, // v13.0.4: disabled — RSS returns forum spam, not articles
  category: "H",
  tier: "legacy", // v13.0.4: moved to legacy
  priority: 5,
  rateLimit: 0,
  supportsImages: false,
  description: "AnandTech — disabled (RSS only returns forum spam). Re-enable if RSS restored.",
  author: "Fredy",
  docsUrl: "https://feeds.feedburner.com/anandtech",
  homepage: "https://www.anandtech.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
  displayIcon: "🔧",
  displaySource: "AnandTech",
  extractRepoFromUrl: false,
};

/**
 * src/plugins/sources/cloudflare-blog/manifest.ts
 * Cloudflare Blog RSS plugin — Tier A.
 * Fetches the latest posts from the Cloudflare blog via RSS.
 * https://blog.cloudflare.com/rss/
 */
import type { PluginManifest } from "../../../types/plugin";

export const cloudflareBlogManifest: PluginManifest = {
  id: "cloudflare-blog",
  name: "Cloudflare Blog",
  version: "1.0.0",
  enabled: true,
  category: "B",
  tier: "A",
  priority: 1,
  rateLimit: 0,
  supportsImages: false,
  description: "Latest posts from the Cloudflare blog (Workers, AI, Security, Performance).",
  author: "Fredy",
  docsUrl: "https://blog.cloudflare.com/rss/",
  homepage: "https://blog.cloudflare.com",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

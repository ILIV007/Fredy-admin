/**
 * src/plugins/sources/github-security/manifest.ts
 * GitHub Security Advisories plugin — Tier B.
 * https://docs.github.com/en/rest/security-advisories
 */
import type { PluginManifest } from "../../../types/plugin";

export const githubSecurityManifest: PluginManifest = {
  id: "github-security",
  name: "GitHub Security Advisories",
  version: "1.0.0",
  enabled: true,
  category: "A",
  tier: "B",
  priority: 1,
  rateLimit: 60,
  supportsImages: false,
  description: "High/Critical security advisories from GitHub (CVSS >= 7, age <= 7 days).",
  author: "Fredy",
  docsUrl: "https://docs.github.com/en/rest/security-advisories",
  homepage: "https://github.com/advisories",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};

/**
 * src/plugins/sources/github-security/index.ts
 * GitHub Security Advisories content source plugin — Tier B.
 *
 * Fetches global security advisories.
 * Quality filter (v11 Phase 2): severity High/Critical, CVSS >= 7, published <= 7 days.
 *
 * https://docs.github.com/en/rest/security-advisories
 */

import type { Plugin, PluginStatus, ProviderQualityResult } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubSecurityManifest } from "./manifest";
export { githubSecurityManifest } from "./manifest";

const GH_API = "https://api.github.com";
const CACHE_KEY = "fredy:source:github-security:latest";
const CACHE_TTL_SECONDS = 12 * 3600; // 12 hours (Tier B)

export interface GitHubSecurityPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface GHAdvisory {
  ghsa_id: string;
  summary: string;
  description?: string;
  severity: string; // "low" | "moderate" | "high" | "critical"
  cvss?: { score?: number };
  published_at?: string;
  html_url?: string;
  cve_id?: string | null;
  references?: readonly { url?: string }[];
}

export class GitHubSecurityPlugin implements Plugin {
  readonly metadata = githubSecurityManifest;

  constructor(private readonly deps: GitHubSecurityPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-security" });

    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) return cached;

    const headers: Record<string, string> = {
      "User-Agent": "FredyBot/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (this.deps.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${this.deps.env.GITHUB_TOKEN}`;
    }

    // Fetch high/critical advisories, sorted by published date
    const url = `${GH_API}/advisories?severity=high&per_page=10&sort=published&direction=desc`;
    const urlCritical = `${GH_API}/advisories?severity=critical&per_page=10&sort=published&direction=desc`;

    try {
      const [highRes, criticalRes] = await Promise.all([
        fetch(url, { headers }),
        fetch(urlCritical, { headers }),
      ]);

      const advisories: GHAdvisory[] = [];
      if (highRes.ok) {
        const data = await highRes.json() as GHAdvisory[];
        advisories.push(...data);
      }
      if (criticalRes.ok) {
        const data = await criticalRes.json() as GHAdvisory[];
        advisories.push(...data);
      }

      const items = advisories
        .map((a) => this.normalize(a))
        .slice(0, 10);

      if (items.length > 0) {
        await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
      }

      this.deps.logger.info("source.fetch_success", {
        plugin: "github-security",
        found: advisories.length,
        returned: items.length,
      });
      return items;
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "github-security",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  normalize(raw: unknown): SourceItem {
    const advisory = raw as GHAdvisory;
    return {
      id: `sec-${advisory.ghsa_id}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: advisory.summary,
      body: String(advisory.description ?? "").slice(0, 1000),
      url: advisory.html_url ?? `https://github.com/advisories/${advisory.ghsa_id}`,
      language: "en",
      publishedAt: advisory.published_at ? Date.parse(advisory.published_at) || undefined : undefined,
      metadata: {
        ghsaId: advisory.ghsa_id,
        cveId: advisory.cve_id,
        severity: advisory.severity,
        cvss: advisory.cvss?.score ?? 0,
      },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("github.com");
  }

  async qualityFilter(item: SourceItem): Promise<ProviderQualityResult | null> {
    const meta = item.metadata as { severity?: string; cvss?: number };
    const severity = (meta.severity ?? "").toLowerCase();
    const cvss = meta.cvss ?? 0;

    // Severity: High or Critical only
    if (severity !== "high" && severity !== "critical") return null;

    // CVSS >= 7
    if (cvss < 7) return null;

    // Published <= 7 days
    if (item.publishedAt) {
      const ageDays = (Date.now() - item.publishedAt) / (24 * 3600 * 1000);
      if (ageDays > 7) return null;
    }

    let score = 80;
    if (severity === "critical") score = 98;
    else if (cvss >= 9) score = 95;
    else if (cvss >= 8) score = 90;
    else score = 82;

    return {
      item,
      score,
      reason: `severity=${severity}, cvss=${cvss}`,
      boost: severity === "critical",
    };
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
      itemsAccepted: 0, itemsRejected: 0, averageLatencyMs: null,
      consecutiveEmptyFetches: 0, currentBackoffMultiplier: 1, lastRefreshAt: null,
    };
  }
}

export function createGitHubSecurityPlugin(deps: GitHubSecurityPluginDeps): GitHubSecurityPlugin {
  return new GitHubSecurityPlugin(deps);
}

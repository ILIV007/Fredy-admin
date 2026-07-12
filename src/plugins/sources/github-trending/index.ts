import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubTrendingManifest } from "./manifest";
export interface GitHubTrendingPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class GitHubTrendingPlugin implements Plugin {
  readonly metadata = githubTrendingManifest;
  constructor(private readonly deps: GitHubTrendingPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-trending" });
    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "Fredy-Bot" };
    if (this.deps.env.GITHUB_TOKEN) headers.Authorization = `token ${this.deps.env.GITHUB_TOKEN}`;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = await fetch(`https://api.github.com/search/repositories?q=created:>${sevenDaysAgo}+stars:>100&sort=stars&order=desc&per_page=5`, { headers });
    if (!r.ok) throw new Error(`GitHub Trending ${r.status}`);
    const data = await r.json() as { items?: Array<Record<string, unknown>> };
    return (data.items ?? []).map((repo) => this.normalize(repo));
  }
  normalize(raw: unknown): SourceItem {
    const r = raw as Record<string, unknown>;
    return { id: String(r["full_name"] ?? r["id"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: String(r["full_name"] ?? r["name"] ?? ""), body: String(r["description"] ?? ""), url: String(r["html_url"] ?? ""), language: "en", publishedAt: r["created_at"] ? Date.parse(String(r["created_at"])) : undefined, metadata: { stars: r["stargazers_count"], language: r["language"] }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url && item.url.includes("github.com"); }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createGitHubTrendingPlugin(deps: GitHubTrendingPluginDeps): GitHubTrendingPlugin { return new GitHubTrendingPlugin(deps); }

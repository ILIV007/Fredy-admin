import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubManifest } from "./manifest";
export interface GitHubPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class GitHubPlugin implements Plugin {
  readonly metadata = githubManifest;
  constructor(private readonly deps: GitHubPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github" });
    const d = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    const h: Record<string,string> = { "Accept": "application/vnd.github.v3+json", "User-Agent": "Fredy-Bot" };
    if (this.deps.env.GITHUB_TOKEN) h["Authorization"] = `token ${this.deps.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/search/repositories?q=created:>${d}+stars:>50&sort=stars&order=desc&per_page=10`, { headers: h });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const data = await r.json() as { items?: Array<Record<string, unknown>> };
    return (data.items ?? []).map(repo => this.normalize(repo));
  }
  normalize(raw: unknown): SourceItem {
    const r = raw as Record<string, unknown>;
    const fn = String(r["full_name"] ?? "");
    return { id: fn, source: this.metadata.id, category: this.metadata.category, title: fn, body: String(r["description"] ?? ""), url: String(r["html_url"] ?? `https://github.com/${fn}`), language: "en", publishedAt: r["created_at"] ? Date.parse(String(r["created_at"])) : undefined, metadata: { stars: r["stargazers_count"], forks: r["forks_count"], language: r["language"] }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.id && !!item.title && !!item.url; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createGitHubPlugin(deps: GitHubPluginDeps): GitHubPlugin { return new GitHubPlugin(deps); }

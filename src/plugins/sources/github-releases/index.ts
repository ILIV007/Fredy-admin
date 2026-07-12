import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { githubReleasesManifest } from "./manifest";
const REPOS = ["microsoft/vscode", "facebook/react", "vercel/next.js", "rust-lang/rust", "golang/go", "nodejs/node", "denoland/deno", "oven-sh/bun"];
export interface GitHubReleasesPluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
export class GitHubReleasesPlugin implements Plugin {
  readonly metadata = githubReleasesManifest;
  constructor(private readonly deps: GitHubReleasesPluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "github-releases" });
    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "Fredy-Bot" };
    if (this.deps.env.GITHUB_TOKEN) headers.Authorization = `token ${this.deps.env.GITHUB_TOKEN}`;
    const repo = REPOS[Math.floor(Math.random() * REPOS.length)]!;
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!r.ok) throw new Error(`GitHub Releases ${r.status}`);
    const data = await r.json() as Record<string, unknown>;
    return [this.normalize(data)];
  }
  normalize(raw: unknown): SourceItem {
    const r = raw as Record<string, unknown>;
    const repo = (String(r["html_url"] ?? "").match(/github\.com\/([^/]+\/[^/]+)\//) ?? [])[1] ?? "";
    return { id: String(r["id"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: `${repo} ${r["tag_name"] ?? ""}`, body: String(r["body"] ?? r["name"] ?? ""), url: String(r["html_url"] ?? ""), language: "en", publishedAt: r["published_at"] ? Date.parse(String(r["published_at"])) : undefined, metadata: { tagName: r["tag_name"], repo }, fetchedAt: Date.now() };
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url && item.url.includes("github.com"); }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createGitHubReleasesPlugin(deps: GitHubReleasesPluginDeps): GitHubReleasesPlugin { return new GitHubReleasesPlugin(deps); }

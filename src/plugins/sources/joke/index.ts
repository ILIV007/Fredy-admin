import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { jokeManifest } from "./manifest";

export interface JokePluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }

export class JokePlugin implements Plugin {
  readonly metadata = jokeManifest;
  constructor(private readonly deps: JokePluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "joke" });
    const r = await fetch("https://v2.jokeapi.dev/joke/Programming?safe-mode=true&amount=5");
    if (!r.ok) throw new Error(`JokeAPI ${r.status}`);
    const data = await r.json() as Record<string, unknown>;
    const jokes = (data["jokes"] ?? [data]) as Array<Record<string, unknown>>;
    return jokes.map((j) => this.normalize(j));
  }

  normalize(raw: unknown): SourceItem {
    const joke = raw as Record<string, unknown>;
    const type = String(joke["type"] ?? "single");
    const setup = type === "twopart" ? String(joke["setup"] ?? "") : String(joke["joke"] ?? "");
    const punchline = type === "twopart" ? String(joke["delivery"] ?? "") : "";
    return { id: String(joke["id"] ?? Date.now()), source: this.metadata.id, category: this.metadata.category, title: setup, body: punchline, url: "https://v2.jokeapi.dev/", language: "en", metadata: { type, setup, punchline }, fetchedAt: Date.now() };
  }

  validate(item: SourceItem): boolean { return !!item.title && item.title.length > 5; }

  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createJokePlugin(deps: JokePluginDeps): JokePlugin { return new JokePlugin(deps); }

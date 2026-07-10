/**
 * src/plugins/sources/joke/index.ts
 * JokeAPI content source plugin.
 *
 * Fetches programming jokes from JokeAPI v2.
 * Category C (NASA / joke / quote / fact — text-only).
 * See FREDY_GUIDELINES.md §6.4.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { jokeManifest } from "./manifest";

export interface JokePluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class JokePlugin implements Plugin {
  readonly metadata = jokeManifest;

  constructor(private readonly deps: JokePluginDeps) {}

  getSource(): string {
    return this.metadata.id;
  }

  getCategory(): Category {
    return this.metadata.category;
  }

  supportsMedia(): boolean {
    return this.metadata.supportsImages;
  }

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Prompt 7 — call
    // GET https://v2.jokeapi.dev/joke/Programming?safe-mode=true&type=twopart
    // No API key needed. Cache 60 min.
    // Filter out: jokes mocking specific people/companies/marginalized groups.
    this.deps.logger.info("source.fetch_start", { plugin: "joke" });
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const joke = raw as Record<string, unknown>;
    const type = String(joke["type"] ?? "single");
    const setup = type === "twopart"
      ? String(joke["setup"] ?? "")
      : String(joke["joke"] ?? "");
    const punchline = type === "twopart"
      ? String(joke["delivery"] ?? "")
      : "";
    return {
      id: String(joke["id"] ?? Date.now()),
      source: this.metadata.id,
      category: this.metadata.category,
      title: setup,
      body: punchline,
      url: "https://v2.jokeapi.dev/",
      metadata: { type, setup, punchline },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    if (!item.title) return false;
    if (item.title.length < 5) return false;
    return true;
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true, // JokeAPI needs no API key
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastItemCount: null,
    };
  }
}

export function createJokePlugin(deps: JokePluginDeps): JokePlugin {
  return new JokePlugin(deps);
}

export { jokeManifest } from "./manifest";

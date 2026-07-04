/**
 * src/plugins/sources/stackexchange/index.ts
 * Stack Exchange content source plugin.
 *
 * Fetches top questions from Stack Overflow.
 * Category A (programming, dev tips, best practices).
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { stackexchangeManifest } from "./manifest";

const SO_API = "https://api.stackexchange.com/2.3";

export interface StackExchangePluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

export class StackExchangePlugin implements Plugin {
  readonly metadata = stackexchangeManifest;

  constructor(private readonly deps: StackExchangePluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "stackexchange" });
    // TODO: implement real fetch.
    // GET /questions?order=desc&sort=hot&site=stackoverflow&filter=withbody
    // Filter: score > 10, is_answered
    return [];
  }

  normalize(raw: unknown): SourceItem {
    const q = raw as Record<string, unknown>;
    return {
      id: String(q["question_id"] ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(q["title"] ?? ""),
      body: String(q["body"] ?? q["excerpt"] ?? ""),
      url: String(q["link"] ?? ""),
      language: "en",
      publishedAt: q["creation_date"] ? Number(q["creation_date"]) * 1000 : undefined,
      metadata: { score: q["score"], tags: q["tags"], isAnswered: q["is_answered"] },
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.url && item.url.includes("stackoverflow.com");
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
      consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0,
      rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null,
    };
  }
}

export function createStackExchangePlugin(deps: StackExchangePluginDeps): StackExchangePlugin {
  return new StackExchangePlugin(deps);
}

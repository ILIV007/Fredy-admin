/**
 * src/plugins/sources/stackexchange/index.ts
 * Stack Exchange content source plugin.
 *
 * Fetches top questions from Stack Overflow.
 * Category A (programming, dev tips, best practices).
 *
 * StackExchange API requires a User-Agent header or may return 403.
 * See: https://api.stackexchange.com/docs
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { stackexchangeManifest } from "./manifest";
export { stackexchangeManifest } from "./manifest";

const SO_API = "https://api.stackexchange.com/2.3";
const CACHE_KEY = "fredy:source:stackexchange:top";
const CACHE_TTL_SECONDS = 24 * 3600; // 24 hours (long cache to avoid throttle)

// Programming tags to filter by (rotates for variety)
const TAG_SETS = [
  ["javascript", "typescript"],
  ["python"],
  ["rust"],
  ["go"],
  ["java"],
  ["c++"],
  ["react"],
  ["node.js"],
  ["docker"],
  ["git"],
];

export interface StackExchangePluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface SOQuestion {
  question_id?: number;
  title?: string;
  body?: string;
  excerpt?: string;
  link?: string;
  score?: number;
  tags?: string[];
  is_answered?: boolean;
  creation_date?: number;
  owner?: { display_name?: string };
}

export class StackExchangePlugin implements Plugin {
  readonly metadata = stackexchangeManifest;

  constructor(private readonly deps: StackExchangePluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "stackexchange" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "stackexchange", count: cached.length });
      return cached;
    }

    // Pick a random tag set for variety
    const tags = TAG_SETS[Math.floor(Math.random() * TAG_SETS.length)]!;
    const tagged = tags.join(";");

    // Build URL — use default filter (no custom filter to avoid 400 errors)
    // The default filter returns: title, link, score, tags, is_answered, creation_date
    // We don't get the body, but that's OK — the AI generates the body.
    const params = new URLSearchParams({
      order: "desc",
      sort: "votes",
      tagged,
      site: "stackoverflow",
      pagesize: "20",
    });

    const url = `${SO_API}/questions?${params.toString()}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      // StackExchange returns 400 on throttle violation (shared Cloudflare IPs).
      // Return empty array instead of throwing so the pipeline can try other plugins.
      const body = await res.text().catch(() => "");
      if (res.status === 400 && body.includes("throttle")) {
        this.deps.logger.warn("source.throttled", {
          plugin: "stackexchange",
          message: "StackExchange API throttled — skipping (will retry from cache next time)",
        });
        return [];
      }
      throw new Error(`SO API ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as { items?: SOQuestion[]; error_id?: number; error_message?: string };
    if (data.error_id) {
      // Throttle or other API error — return empty gracefully.
      this.deps.logger.warn("source.api_error", {
        plugin: "stackexchange",
        errorId: data.error_id,
        errorMessage: data.error_message,
      });
      return [];
    }
    const questions = data.items ?? [];

    // Filter: score > 1, is_answered (lowered threshold to get more results)
    const filtered = questions
      .filter((q) => (q.score ?? 0) > 1 && q.is_answered)
      .slice(0, 10);

    const items = filtered.map((q) => this.normalize(q));

    // Cache the result
    if (items.length > 0) {
      await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "stackexchange",
      tags,
      totalQuestions: questions.length,
      filtered: filtered.length,
      returned: items.length,
    });

    return items;
  }

  normalize(raw: unknown): SourceItem {
    const q = raw as SOQuestion;
    // When no body is returned (default filter), build a fallback body from tags.
    const body = q.body ?? q.excerpt ?? (q.tags && q.tags.length > 0
      ? `Tags: ${q.tags.join(", ")}`
      : "");
    return {
      id: String(q.question_id ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(q.title ?? ""),
      body: String(body),
      url: String(q.link ?? ""),
      language: "en",
      publishedAt: q.creation_date ? q.creation_date * 1000 : undefined,
      metadata: {
        score: q.score,
        tags: q.tags,
        isAnswered: q.is_answered,
        author: q.owner?.display_name,
      },
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

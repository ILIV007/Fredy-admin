<<<<<<< HEAD
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

=======
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { stackexchangeManifest } from "./manifest";
<<<<<<< HEAD

const SO_API = "https://api.stackexchange.com/2.3";
const CACHE_KEY = "fredy:source:stackexchange:top";
const CACHE_TTL_SECONDS = 2 * 3600; // 2 hours

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

=======
export interface StackExchangePluginDeps { readonly env: Env; readonly kv: KVStore; readonly logger: PluginLogger; }
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
export class StackExchangePlugin implements Plugin {
  readonly metadata = stackexchangeManifest;
  constructor(private readonly deps: StackExchangePluginDeps) {}
  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }
  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "stackexchange" });
<<<<<<< HEAD

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "stackexchange", count: cached.length });
      return cached;
    }

    // Pick a random tag set for variety
    const tags = TAG_SETS[Math.floor(Math.random() * TAG_SETS.length)]!;
    const tagged = tags.join(";");

    // Build URL with filter to get question body
    // filter=withbody returns the question body as HTML
    const params = new URLSearchParams({
      order: "desc",
      sort: "votes",
      tagged,
      site: "stackoverflow",
      pagesize: "20",
      filter: "!nNPvSNdWme",
      key: "fredy)1Lx0pGRM5DO4nH5TQ((",
    });

    const url = `${SO_API}/questions?${params.toString()}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "FredyBot/1.0 (https://github.com/ilivir3/fredy; Cloudflare Workers)",
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
      },
    });

    if (!res.ok) {
      throw new Error(`SO API ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as { items?: SOQuestion[] };
    const questions = data.items ?? [];

    // Filter: score > 5, is_answered
    const filtered = questions
      .filter((q) => (q.score ?? 0) > 5 && q.is_answered)
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
=======
    const r = await fetch("https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=10", { headers: { "User-Agent": "Fredy-Bot/1.0", "Accept": "application/json" } });
    if (!r.ok) throw new Error(`SO ${r.status}`);
    const data = await r.json() as { items?: Array<Record<string, unknown>> };
    return (data.items ?? []).map(q => this.normalize(q));
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  normalize(raw: unknown): SourceItem {
<<<<<<< HEAD
    const q = raw as SOQuestion;
    return {
      id: String(q.question_id ?? ""),
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(q.title ?? ""),
      body: String(q.body ?? q.excerpt ?? ""),
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
=======
    const q = raw as Record<string, unknown>;
    return { id: String(q["question_id"] ?? ""), source: this.metadata.id, category: this.metadata.category, title: String(q["title"] ?? ""), body: String(q["body"] ?? ""), url: String(q["link"] ?? ""), language: "en", publishedAt: q["creation_date"] ? Number(q["creation_date"])*1000 : undefined, metadata: { score: q["score"], tags: q["tags"] }, fetchedAt: Date.now() };
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }
  validate(item: SourceItem): boolean { return !!item.title && !!item.url; }
  async health(): Promise<PluginStatus> { return { pluginId: this.metadata.id, healthy: true, enabled: this.metadata.enabled, lastFetchAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, consecutiveFailures: 0, totalFetches: 0, totalSuccesses: 0, totalFailures: 0, rateLimitRemaining: null, rateLimitResetAt: null, lastItemCount: null }; }
}
export function createStackExchangePlugin(deps: StackExchangePluginDeps): StackExchangePlugin { return new StackExchangePlugin(deps); }

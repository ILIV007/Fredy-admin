/**
 * src/plugins/sources/news.ts
 * Tech news source via NewsAPI.org. Skeleton only.
 * See FREDY_GUIDELINES.md §6.2 (Category B format).
 */

import type { ContentSource } from "../../types/plugin";
import type { HealthStatus, SourceItem } from "../../types/api";

export interface NewsSourceDeps {
  readonly apiKey: string;
}

export class NewsSource implements ContentSource {
  readonly name = "news";
  readonly category = "B" as const;
  readonly label = "Tech News";

  constructor(private readonly deps: NewsSourceDeps) {}

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Phase 3 — call
    // https://newsapi.org/v2/top-headlines?category=technology&language=en
    // Free tier: 100 req/day, 1 req/sec. Cache 60 min.
    // Filter out: politics, general news, opinion pieces.
    return [];
  }

  async health(): Promise<HealthStatus> {
    return {
      source: this.name,
      healthy: !!this.deps.apiKey,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: this.deps.apiKey ? null : "NEWSAPI_KEY not set",
      consecutiveFailures: 0,
    };
  }
}

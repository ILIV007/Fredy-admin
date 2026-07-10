/**
 * src/plugins/sources/github.ts
 * GitHub trending / new releases source. Skeleton only — no API calls yet.
 * See FREDY_GUIDELINES.md §6.1 (Category A format).
 */

import type { ContentSource } from "../../types/plugin";
import type { HealthStatus, SourceItem } from "../../types/api";

export interface GitHubSourceDeps {
  readonly token?: string;
}

export class GitHubSource implements ContentSource {
  readonly name = "github";
  readonly category = "A" as const;
  readonly label = "GitHub";

  constructor(private readonly deps: GitHubSourceDeps) {}

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Phase 3 — call GitHub Search API for trending repos
    // (https://api.github.com/search/repositories?q=created:>YYYY-MM-DD&sort=stars).
    // Use token if provided for higher rate limit (5 000/hr vs 60/hr).
    // Cache results in KV (fredy:source:github:cache) for 30 min.
    return [];
  }

  async health(): Promise<HealthStatus> {
    // TODO: implement in Phase 3 — check rate-limit headers from last response.
    return {
      source: this.name,
      healthy: true,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
    };
  }
}

/**
 * src/plugins/sources/joke.ts
 * Programming joke source via JokeAPI v2. Skeleton only.
 * See FREDY_GUIDELINES.md §6.4 (Category C — Joke format).
 */

import type { ContentSource } from "../../types/plugin";
import type { HealthStatus, SourceItem } from "../../types/api";

export interface JokeSourceDeps {
  // JokeAPI needs no key.
}

export class JokeSource implements ContentSource {
  readonly name = "joke";
  readonly category = "C" as const;
  readonly label = "Dev Jokes";

  constructor(_deps: JokeSourceDeps = {}) {
    void _deps;
  }

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Phase 3 — call
    // https://v2.jokeapi.dev/joke/Programming?safe-mode=true&type=twopart
    // Free, no key, 120 req/min. Cache 60 min.
    // Filter out: jokes mocking specific people/companies/marginalized groups.
    return [];
  }

  async health(): Promise<HealthStatus> {
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

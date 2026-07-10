/**
 * src/plugins/sources/nasa.ts
 * NASA Astronomy Picture of the Day. Skeleton only.
 * See FREDY_GUIDELINES.md §6.3 (Category C — NASA format, image-first).
 */

import type { ContentSource } from "../../types/plugin";
import type { HealthStatus, SourceItem } from "../../types/api";

export interface NasaSourceDeps {
  readonly apiKey: string;
}

export class NasaSource implements ContentSource {
  readonly name = "nasa";
  readonly category = "C" as const;
  readonly label = "NASA APOD";

  constructor(private readonly deps: NasaSourceDeps) {}

  async fetch(): Promise<readonly SourceItem[]> {
    // TODO: implement in Phase 3 — call
    // https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY
    // Free tier: 1 000 req/hr. Cache 6 hours (one APOD per day).
    // Returns: imageUrl (hdurl), title, caption (explanation).
    // If media_type === "video", return the YouTube URL as the source URL.
    return [];
  }

  async health(): Promise<HealthStatus> {
    return {
      source: this.name,
      healthy: !!this.deps.apiKey,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: this.deps.apiKey ? null : "NASA_API_KEY not set",
      consecutiveFailures: 0,
    };
  }
}

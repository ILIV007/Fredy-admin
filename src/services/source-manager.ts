/**
 * src/services/source-manager.ts
 * Manages content source plugins. The pipeline calls this — never a specific source.
 * See ARCHITECTURE_RULES.md §5 (Plugin First).
 */

import type { Category } from "../types/category";
import type { ContentSource } from "../types/plugin";
import type { FetchResult, HealthStatus, SourceItem } from "../types/api";

export interface SourceManagerDeps {
  readonly sources: readonly ContentSource[];
}

export class SourceManager {
  private readonly sources = new Map<string, ContentSource>();

  constructor(deps: SourceManagerDeps) {
    for (const source of deps.sources) {
      this.sources.set(source.name, source);
    }
  }

  /** Register a new source at runtime (rare — usually done in container.ts). */
  register(source: ContentSource): void {
    this.sources.set(source.name, source);
  }

  /** Get a source by name. */
  get(name: string): ContentSource | null {
    return this.sources.get(name) ?? null;
  }

  /** List all registered sources. */
  list(): readonly ContentSource[] {
    return Array.from(this.sources.values());
  }

  /** Fetch one item for a category, respecting anti-repeat (lastSource). */
  async fetchForCategory(
    category: Category,
    lastSource: string | null,
  ): Promise<FetchResult | null> {
    // TODO: implement in Phase 3 (Content Engine).
    void category;
    void lastSource;
    return null;
  }

  /** Fetch health for all sources (parallel). */
  async healthAll(): Promise<readonly HealthStatus[]> {
    return Promise.all(this.list().map((s) => s.health().catch(() => ({
      source: s.name,
      healthy: false,
      lastSuccessAt: null,
      lastErrorAt: Date.now(),
      lastErrorMessage: "health check threw",
      consecutiveFailures: 1,
    }))));
  }

  /** Fetch one item directly from a named source. Used by manual triggers. */
  async fetchOne(sourceName: string): Promise<SourceItem | null> {
    const source = this.get(sourceName);
    if (!source) return null;
    const items = await source.fetch();
    return items[0] ?? null;
  }
}

/**
 * src/services/content-normalizer.ts
 * Converts ALL provider outputs into a single StandardPost schema.
 *
 * Responsibilities:
 *   - Convert SourceItem (from any provider) to StandardPost
 *   - Remove inconsistencies (trim whitespace, normalize URLs, fix encoding)
 *   - Ensure required fields exist (reject if missing)
 *   - Apply default values if needed (language, publishedAt, score)
 *
 * Provider independence: the normalizer doesn't know which provider
 * produced the item — it works on the SourceItem shape alone.
 * Provider-specific enrichment is handled by EnrichmentEngine.
 *
 * See Prompt 11 spec.
 */

import type { SourceItem } from "../types/api";
import type { StandardPost, ContentMedia, ProviderEnrichment } from "../types/content";
import type { MediaResolver } from "./media-resolver";
import type { PluginManager } from "./plugin-manager";
import type { Logger } from "./logger";
import { sha1 } from "../primitives/hash";
import { collapseWhitespace } from "../primitives/strings";

export interface ContentNormalizerDeps {
  readonly logger: Logger;
  readonly mediaResolver: MediaResolver;
  readonly pluginManager: PluginManager;
}

/** Default score before quality evaluation. */
const DEFAULT_SCORE = 0;

/** Default language if not specified. */
const DEFAULT_LANGUAGE = "en";

export class ContentNormalizer {
  constructor(private readonly deps: ContentNormalizerDeps) {}

  /**
   * Normalize a SourceItem into a StandardPost.
   * Throws if required fields are missing or invalid.
   */
  async normalize(sourceItem: SourceItem, language?: string): Promise<StandardPost> {
    // 1. Validate required fields.
    this.assertRequired(sourceItem);

    // 2. Compute stable ID.
    const id = await this.computeId(sourceItem);

    // 3. Resolve media via MediaResolver.
    const media = await this.resolveMedia(sourceItem);

    // 4. Build provider enrichment (basic — EnrichmentEngine adds more).
    const provider = this.buildProviderEnrichment(sourceItem);

    // 5. Build the StandardPost.
    const post: StandardPost = {
      id,
      title: this.normalizeTitle(sourceItem.title),
      body: this.normalizeBody(sourceItem.body),
      category: sourceItem.category,
      language: language ?? sourceItem.language ?? DEFAULT_LANGUAGE,
      source: sourceItem.source,
      url: this.normalizeUrl(sourceItem.url),
      media,
      tags: [], // TaggingSystem fills this in the next pipeline stage
      provider,
      score: DEFAULT_SCORE,
      createdAt: Date.now(),
      publishedAt: sourceItem.publishedAt ?? null,
      raw: sourceItem,
    };

    return post;
  }

  /** Assert that all required fields exist and are non-empty. */
  private assertRequired(item: SourceItem): void {
    if (!item.id || item.id.trim().length === 0) {
      throw new Error("SourceItem missing required field: id");
    }
    if (!item.title || item.title.trim().length === 0) {
      throw new Error("SourceItem missing required field: title");
    }
    // Body is optional — some sources (HackerNews, XKCD) only have title.
    // The AI will generate the body from the title + URL.
    if (!item.source || item.source.trim().length === 0) {
      throw new Error("SourceItem missing required field: source");
    }
    if (!item.url || item.url.trim().length === 0) {
      throw new Error("SourceItem missing required field: url");
    }
    if (!item.category || !["A", "B", "C"].includes(item.category)) {
      throw new Error(`SourceItem has invalid category: "${item.category}"`);
    }
  }

  /** Compute a stable ID from the source item. */
  private async computeId(item: SourceItem): Promise<string> {
    if (item.url) {
      return `url-${await sha1(item.url)}`;
    }
    const content = `${item.title}|${item.body}`.slice(0, 200);
    return `hash-${await sha1(content)}`;
  }

  /** Resolve media for the source item. */
  private async resolveMedia(item: SourceItem): Promise<ContentMedia | null> {
    const resolved = await this.deps.mediaResolver.resolve(item);
    if (!resolved) return null;
    return {
      type: resolved.type,
      url: resolved.url,
      alt: resolved.alt,
    };
  }

  /** Build basic provider enrichment from the plugin manifest. */
  private buildProviderEnrichment(item: SourceItem): ProviderEnrichment {
    const plugin = this.deps.pluginManager.get(item.source);
    const manifest = plugin?.metadata;

    return {
      id: item.source,
      name: manifest?.name ?? item.source,
      homepage: manifest?.homepage ?? null,
      // Provider-specific fields are added by EnrichmentEngine.
      extra: item.metadata,
    };
  }

  /** Normalize title: trim, collapse whitespace, limit length. */
  private normalizeTitle(title: string): string {
    return collapseWhitespace(title).slice(0, 500);
  }

  /** Normalize body: trim, collapse whitespace, limit length. Falls back to title. */
  private normalizeBody(body: string | null | undefined): string {
    if (!body || body.trim().length === 0) return "";
    return collapseWhitespace(body).slice(0, 4096);
  }

  /** Normalize URL: trim, ensure protocol. */
  private normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return "";
    // Ensure protocol.
    if (!/^https?:\/\//i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  }

  /** Batch-normalize multiple source items. */
  async normalizeAll(items: readonly SourceItem[], language?: string): Promise<readonly StandardPost[]> {
    const posts: StandardPost[] = [];
    for (const item of items) {
      try {
        const post = await this.normalize(item, language);
        posts.push(post);
      } catch (error) {
        this.deps.logger.warn("quality.reject", {
          source: item.source,
          id: item.id,
          error: error instanceof Error ? error.message : String(error),
          stage: "normalize",
        });
      }
    }
    return posts;
  }
}

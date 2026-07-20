/**
 * src/services/content-formatter.ts
 * Assembles the final content structure: ContentItem from SourceItem,
 * and ReadyContent from AI output + quality result.
 *
 * See Prompt 8 spec: "Output clean structured objects for Scheduler."
 */

import type { SourceItem, SourceMedia } from "../types/api";
import type {
  ContentItem,
  ContentMedia,
  ReadyContent,
} from "../types/content";
import type { AIGeneratedContent } from "../types/ai";
import type { QualityResult } from "../types/quality";
import type { MediaHandler } from "./media-handler";
import type { MediaResolver } from "./media-resolver";
import type { SourceFormatter } from "./source-formatter";
import type { Logger } from "./logger";
import { sha1, shortId } from "../primitives/hash";

export interface ContentFormatterDeps {
  readonly logger: Logger;
  readonly mediaHandler: MediaHandler;
  readonly mediaResolver: MediaResolver;
  readonly sourceFormatter: SourceFormatter;
}

export class ContentFormatter {
  constructor(private readonly deps: ContentFormatterDeps) {}

  /** Convert a SourceItem into a normalized ContentItem. */
  async normalize(
    sourceItem: SourceItem,
    language: string,
  ): Promise<ContentItem> {
    const id = await this.computeId(sourceItem);

    // Use MediaResolver to find the best image.
    const resolvedMedia = await this.deps.mediaResolver.resolve(sourceItem);
    const media: ContentMedia | null = resolvedMedia
      ? this.toContentMedia(resolvedMedia)
      : null;

    return {
      id,
      pluginId: sourceItem.source,
      title: sourceItem.title,
      body: sourceItem.body,
      category: sourceItem.category,
      source: sourceItem.source,
      language,
      url: sourceItem.url,
      media,
      fetchedAt: sourceItem.fetchedAt,
      raw: sourceItem,
      // v11.6.0: Carry provider display metadata.
      displayIcon: sourceItem.displayIcon,
      displaySource: sourceItem.displaySource,
    };
  }

  /** Build a ReadyContent from AI output + quality result. */
  async buildReadyContent(
    item: ContentItem,
    aiContent: AIGeneratedContent,
    quality: QualityResult,
    aiProvider: string,
    aiModel: string,
    tokensUsed: number,
    estimatedCost: number,
  ): Promise<ReadyContent> {
    // v11.6.0: Unified provider footer — uses display metadata from the provider.
    // v11.6.1: When displaySource is "Source" (generic), use a random emoji
    // from the pool. When provider has a custom label, use its fixed icon.
    const displaySource = item.displaySource ?? "Source";
    let finalIcon: string;
    if (displaySource === "Source") {
      // Generic "Source" — use random emoji from pool (classic behavior).
      const { emoji } = await this.deps.sourceFormatter.buildFooter();
      finalIcon = emoji;
    } else {
      // Provider has a custom label — use its icon.
      finalIcon = item.displayIcon ?? "🌌";
    }
    const finalEmoji = finalIcon;
    const finalFooter = `${finalIcon} ${displaySource}`;

    return {
      id: item.id,
      pluginId: item.pluginId,
      category: item.category,
      text: aiContent.text,
      headline: aiContent.headline ?? null,
      sourceUrl: item.url,
      sourceFooter: finalFooter,
      sourceEmoji: finalEmoji,
      displayIcon: finalIcon,
      displaySource: displaySource,
      media: item.media,
      language: aiContent.generatedLanguage,
      quality,
      aiProvider,
      aiModel,
      tokensUsed,
      estimatedCost,
      processedAt: Date.now(),
      fetchedAt: item.fetchedAt,
    };
  }

  // v11.6.0: extractGitHubRepo removed — providers now handle repo extraction
  // in their normalize() method via displaySource. No hardcoded provider lists.

  /** Convert a SourceMedia to a ContentMedia. */
  private toContentMedia(source: SourceMedia): ContentMedia {
    return {
      type: source.type,
      url: source.url,
      alt: source.alt,
    };
  }

  /** Compute a stable ID for a source item. */
  private async computeId(sourceItem: SourceItem): Promise<string> {
    // Use the URL if available, otherwise hash the title+body.
    if (sourceItem.url) {
      return `url-${await sha1(sourceItem.url)}`;
    }
    const content = `${sourceItem.title}|${sourceItem.body}`.slice(0, 200);
    return `hash-${await sha1(content)}`;
  }

  /** Generate a short unique ID (for queue items). */
  generateQueueId(): string {
    return shortId();
  }
}

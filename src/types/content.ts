/**
 * src/types/content.ts
 * Content engine types — the artifacts that flow through the content pipeline.
 *
 * Pipeline:
 *   Plugin.fetch() → SourceItem → ContentItem → ReadyContent
 *                  (normalize)   (validate+dedup+category)  (after AI + quality)
 *
 * See FREDY_GUIDELINES.md and Prompt 8 spec.
 */

import type { Category } from "./category";
import type { SourceItem } from "./api";
import type { AIGeneratedContent } from "./ai";
import type { QualityResult } from "./quality";

// ────────────────────────────────────────────────────────────
// Content Item — normalized, before AI processing
// ────────────────────────────────────────────────────────────

/**
 * A normalized content item, ready for validation and AI processing.
 * Produced by ContentFormatter from a SourceItem.
 */
export interface ContentItem {
  /** Unique ID (hash of source URL or source+title). */
  readonly id: string;

  /** The source plugin that produced this item. */
  readonly pluginId: string;

  /** Title or headline. */
  readonly title: string;

  /** Body text (raw from source, before AI). */
  readonly body: string;

  /** Category (A/B/C). May be confirmed or detected by CategoryResolver. */
  readonly category: Category;

  /** Source identifier (same as pluginId, kept for clarity). */
  readonly source: string;

  /** Detected or requested language. */
  readonly language: string;

  /** Canonical URL to the original content. */
  readonly url: string;

  /** Media (image/video URL) if the source provides one (e.g., NASA). */
  readonly media: ContentMedia | null;

  /** When the item was fetched. */
  readonly fetchedAt: number;

  /** Original source item (for reference). */
  readonly raw: SourceItem;

  // ─── v11.6.0: Provider Display Metadata (carried from SourceItem) ───
  readonly displayIcon?: string;
  readonly displaySource?: string;
}

/** Media attached to a content item. */
export interface ContentMedia {
  readonly type: "image" | "video" | "animation" | "none";
  readonly url: string;
  readonly alt?: string;
}

// ────────────────────────────────────────────────────────────
// Ready Content — after AI + quality, ready for the scheduler
// ────────────────────────────────────────────────────────────

/**
 * A fully processed content item, ready to be published by the scheduler.
 * This is what goes into the Ready Queue.
 */
export interface ReadyContent {
  /** Same ID as the ContentItem. */
  readonly id: string;

  /** The source plugin that produced this item. */
  readonly pluginId: string;

  /** Category (A/B/C). */
  readonly category: Category;

  /** The AI-generated text (formatted, Telegram-ready HTML). */
  readonly text: string;

  /** The headline (from AI, optional). */
  readonly headline: string | null;

  /** The source URL (for the footer link). */
  readonly sourceUrl: string;

  /** The source footer line: "[emoji] label" (e.g., "☁️ Cloudflare Blog" or "🐙 microsoft/vscode"). */
  readonly sourceFooter: string;

  /** The emoji used in the source footer. */
  readonly sourceEmoji: string;

  // ─── v11.6.0: Provider Display Metadata (carried from ContentItem) ───
  readonly displayIcon?: string;
  readonly displaySource?: string;

  /** Media (image) if applicable (e.g., NASA). */
  readonly media: ContentMedia | null;

  /** The language the content was generated in. */
  readonly language: string;

  /** The quality result from the Quality Engine. */
  readonly quality: QualityResult;

  /** The AI provider and model used. */
  readonly aiProvider: string;
  readonly aiModel: string;

  /** Token usage and estimated cost. */
  readonly tokensUsed: number;
  readonly estimatedCost: number;

  /** When the item was processed. */
  readonly processedAt: number;

  /** When the item was originally fetched. */
  readonly fetchedAt: number;
}

// ────────────────────────────────────────────────────────────
// Pipeline result
// ────────────────────────────────────────────────────────────

/** Result of running one item through the content pipeline. */
export interface PipelineResult {
  readonly ok: boolean;
  readonly content: ReadyContent | null;
  readonly item: ContentItem | null;
  readonly stage: PipelineStage;
  readonly error?: string;
  readonly rejectedReason?: RejectionReason;
  /** When the item is a duplicate, info about the previously-published item.
   *  v11.13.0: Added "canonical" reason (Layer 1 — canonical ID match). */
  readonly duplicateOf?: {
    readonly contentId: string;
    readonly reason: "canonical" | "url" | "hash" | "title";
  };
  /** AI debug info (when AI fails or format-only fallback is used). */
  readonly aiDebug?: {
    readonly error: string;
    readonly attempts: ReadonlyArray<{ readonly provider: string; readonly model: string; readonly ok: boolean; readonly error?: string }>;
    readonly usedFallback: boolean;
    readonly fallbackReason: string;
  };
}

/** Stages of the pipeline (for tracing). */
export type PipelineStage =
  | "normalize"
  | "validate"
  | "duplicate_check"
  | "category_resolve"
  | "ai_generate"
  | "quality_score"
  | "format"
  | "enqueue"
  | "complete"
  | "rejected";

/** Why an item was rejected. */
export type RejectionReason =
  | "empty_content"
  | "duplicate_url"
  | "duplicate_hash"
  | "duplicate_title"
  | "unsupported_language"
  | "invalid_media"
  | "invalid_source"
  | "ai_failed"
  | "quality_below_threshold"
  | "quality_hard_reject"
  | "kv_quota";

// ────────────────────────────────────────────────────────────
// Duplicate detection
// ────────────────────────────────────────────────────────────

/** A record in the duplicate detection store. */
export interface DedupRecord {
  readonly hash: string;
  readonly url: string;
  readonly titleHash: string;
  readonly contentId: string;
  readonly pluginId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Result of a duplicate check.
 *  v11.13.0: Added "canonical" reason (Layer 1 — canonical ID match). */
export interface DuplicateCheckResult {
  readonly isDuplicate: boolean;
  readonly reason: "canonical" | "url" | "hash" | "title" | null;
  readonly existingId: string | null;
}

// ────────────────────────────────────────────────────────────
// Content queue
// ────────────────────────────────────────────────────────────

/** An item in the ready queue, waiting to be picked up by the scheduler. */
export interface QueuedContent {
  readonly id: string;
  readonly category: Category;
  readonly content: ReadyContent;
  readonly enqueuedAt: number;
  readonly expiresAt: number;
  readonly attempts: number;
  readonly lastAttemptAt: number | null;
}

/** Queue depth per category (for the dashboard). */
export interface QueueDepth {
  readonly category: Category;
  readonly depth: number;
  readonly oldestItemAge: number | null;
}

// ────────────────────────────────────────────────────────────
// Standard Post Schema (Prompt 11)
// ────────────────────────────────────────────────────────────

/**
 * The unified standard post schema. ALL content from ALL providers
 * is transformed into this shape before entering the pipeline.
 *
 * Required fields: id, title, body, category, language, source, media,
 *                  tags, provider, score, createdAt
 *
 * See Prompt 11 spec.
 */
export interface StandardPost {
  /** Unique identifier (hash of URL or title+body). */
  readonly id: string;

  /** Title or headline. */
  readonly title: string;

  /** Body text (raw from provider, before AI). */
  readonly body: string;

  /** Category (A/B/C). */
  readonly category: Category;

  /** Content language (en, fa, or auto). */
  readonly language: string;

  /** Source identifier (plugin ID, e.g., "github", "nasa"). */
  readonly source: string;

  /** Canonical URL to the original content. */
  readonly url: string;

  /** Media (image/video) attached to the post. */
  readonly media: ContentMedia | null;

  /** Auto-assigned tags (e.g., "ai", "programming", "open-source"). */
  readonly tags: readonly string[];

  /** Provider metadata (enrichment data — stars, forks, author, etc.). */
  readonly provider: ProviderEnrichment;

  /** Quality score (0-100). Attached after quality evaluation. */
  readonly score: number;

  /** When the standard post was created (epoch ms). */
  readonly createdAt: number;

  /** When the content was originally published (if known). */
  readonly publishedAt: number | null;

  /** Original source item (for reference). */
  readonly raw: SourceItem;

  // ─── v11.6.0: Provider Display Metadata (carried from SourceItem) ───
  readonly displayIcon?: string;
  readonly displaySource?: string;
}

/**
 * Enrichment data attached to a StandardPost.
 * Different providers populate different fields.
 */
export interface ProviderEnrichment {
  /** The provider ID (e.g., "github", "news", "nasa"). */
  readonly id: string;

  /** The provider's display name. */
  readonly name: string;

  /** Provider homepage URL. */
  readonly homepage: string | null;

  // GitHub-specific
  readonly stars?: number;
  readonly forks?: number;
  readonly language?: string;
  readonly license?: string;
  readonly lastUpdate?: number;
  readonly topics?: readonly string[];

  // News-specific
  readonly author?: string;
  readonly publishDate?: number;
  readonly sourceCredibility?: "high" | "medium" | "low" | "unknown";

  // Tags (Dev.to, StackExchange, GitHub topics — shared field)
  readonly tags?: readonly string[];

  // Tech Tools-specific
  readonly officialSite?: string;
  readonly documentation?: string;
  readonly pricing?: string;

  // NASA-specific
  readonly imageMetadata?: {
    readonly type: "image" | "video";
    readonly date: string;
    readonly explanation: string;
  };

  // Generic metadata bag (for provider-specific fields not covered above).
  readonly extra?: Readonly<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────
// Final Post (Prompt 13 — Final Publishing Engine)
// ────────────────────────────────────────────────────────────

/**
 * The final Telegram-ready post. Assembled by the UX Layer from
 * ReadyContent + a dynamic hook. This is what gets published.
 *
 * Structure:
 *   [HOOK]          — dynamic, content-aware, 1 line max
 *   [BODY]          — 2-5 lines, humanized
 *   [TAKEAWAY]      — key insight line
 *   [SOURCE_LINE]   — 🌌 Source
 *
 * See Prompt 13 spec.
 */
export interface FinalPost {
  /** The dynamic hook (1 line, increases curiosity). */
  readonly hook: string;

  /** The body text (2-5 lines, humanized, no metadata). */
  readonly body: string;

  /** The key insight or takeaway line. */
  readonly takeaway: string;

  /** The source line: "[emoji] label" (e.g., "☁️ Cloudflare Blog" or "🐙 microsoft/vscode"). */
  readonly sourceLine: string;

  /** The source emoji. */
  readonly sourceEmoji: string;

  /** v11.6.0: Display icon from provider metadata. */
  readonly displayIcon?: string;

  /** v11.6.0: Display source from provider metadata. */
  readonly displaySource?: string;

  /** The source URL (for the blockquote link). */
  readonly sourceUrl: string;

  /** Media (image) if available, from MediaResolver only. */
  readonly media: ContentMedia | null;

  /** The full assembled post text (hook + body + takeaway + source). */
  readonly fullText: string;

  /** The caption for image posts (shorter version). */
  readonly caption: string;

  /** Language of the post. */
  readonly language: string;

  /** Category (A/B/C). */
  readonly category: Category;

  /** Internal quality score (NOT visible in the post). */
  readonly score: number;

  /** Internal metadata (NOT visible in the post). */
  readonly internalMetadata: {
    readonly contentId: string;
    readonly pluginId: string;
    readonly aiProvider: string;
    readonly aiModel: string;
    readonly tokensUsed: number;
    readonly estimatedCost: number;
    readonly qualityScore: number;
    readonly processedAt: number;
  };
}

// ────────────────────────────────────────────────────────────
// Re-export AI types for convenience
// ────────────────────────────────────────────────────────────

export type { AIGeneratedContent, QualityResult };

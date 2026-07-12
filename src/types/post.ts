/**
 * src/types/post.ts
 * Post domain types — the artifact Fredy publishes.
 */

import type { Category } from "./category";

/** The parse mode Telegram expects. Fredy uses HTML exclusively. */
export type ParseMode = "HTML" | "MarkdownV2" | null;

/** Media type for posts that include an image or video. */
export type MediaType = "photo" | "video" | "animation" | "none";

/**
 * A post ready to publish. Produced by the pipeline after quality filter passes.
 * Immutable once constructed.
 */
export interface Post {
  readonly id: string;
  readonly category: Category;
  readonly source: string;
  readonly text: string;
  readonly parseMode: ParseMode;
  readonly mediaType: MediaType;
  readonly mediaUrl: string | null;
  readonly sourceUrl: string | null;
  readonly sourceEmoji: string;
  readonly language: string;
  readonly qualityScore: number;
  readonly generatedAt: number;
  readonly aiProvider: string;
  readonly aiModel: string;
}

/** A post after it was published to Telegram. */
export interface PublishedPost {
  readonly post: Post;
  readonly publishedAt: number;
  readonly telegramMessageId: number;
  readonly telegramChatId: string;
}

/** A post that was rejected by the quality filter or admin. */
export interface RejectedPost {
  readonly post: Post;
  readonly rejectedAt: number;
  readonly reason: string;
  readonly qualityScore: number;
  readonly failedChecks: readonly string[];
}

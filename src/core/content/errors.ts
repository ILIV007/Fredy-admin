/**
 * src/core/content/errors.ts
 * Content-specific error hierarchy. See ARCHITECTURE_RULES.md §9.3.
 */

import { AppError } from "../errors";

/** Base class for all content errors. */
export class ContentError extends AppError {
  constructor(
    message: string,
    public readonly contentId?: string,
    public readonly pluginId?: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { contentId, pluginId, ...context });
  }
}

/** Thrown when content is empty or has no usable text. */
export class EmptyContentError extends ContentError {
  constructor(pluginId: string, contentId?: string) {
    super("Content is empty or has no usable text", contentId, pluginId);
  }
}

/** Thrown when content is a duplicate. */
export class DuplicateContentError extends ContentError {
  constructor(
    public readonly reason: "url" | "hash" | "title",
    public readonly existingId: string,
    contentId: string,
    pluginId: string,
  ) {
    super(`Duplicate content detected (${reason} match)`, contentId, pluginId, { reason, existingId });
  }
}

/** Thrown when content language is not supported. */
export class UnsupportedLanguageError extends ContentError {
  constructor(
    public readonly language: string,
    contentId: string,
    pluginId: string,
  ) {
    super(`Unsupported language: "${language}"`, contentId, pluginId, { language });
  }
}

/** Thrown when media URL is invalid or unreachable. */
export class InvalidMediaError extends ContentError {
  constructor(
    public readonly mediaUrl: string,
    public readonly reason: string,
    contentId: string,
    pluginId: string,
  ) {
    super(`Invalid media: ${reason}`, contentId, pluginId, { mediaUrl, reason });
  }
}

/** Thrown when the source plugin is invalid or not registered. */
export class InvalidSourceError extends ContentError {
  constructor(
    public readonly sourceId: string,
    contentId: string,
  ) {
    super(`Invalid or unregistered source: "${sourceId}"`, contentId, sourceId);
  }
}

/** Thrown when content fails validation. */
export class ContentValidationError extends ContentError {
  constructor(
    message: string,
    public readonly errors: readonly string[],
    contentId: string,
    pluginId: string,
  ) {
    super(message, contentId, pluginId, { errors });
  }
}

/** Thrown when the AI generation stage fails. */
export class AIGenerationError extends ContentError {
  constructor(
    message: string,
    contentId: string,
    pluginId: string,
  ) {
    super(`AI generation failed: ${message}`, contentId, pluginId);
  }
}

/** Thrown when content quality is below threshold. */
export class QualityThresholdError extends ContentError {
  constructor(
    public readonly score: number,
    public readonly minScore: number,
    contentId: string,
    pluginId: string,
  ) {
    super(`Quality score ${score} below threshold ${minScore}`, contentId, pluginId, { score, minScore });
  }
}

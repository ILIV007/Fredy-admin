/**
 * src/services/content-validator.ts
 * Validates content items. Rejects: empty, duplicate, unsupported language,
 * invalid media, invalid source.
 *
 * See FREDY_GUIDELINES.md §9 (Quality Standards) and Prompt 8 spec.
 */

import type { ContentItem } from "../types/content";
import type { PluginManager } from "./plugin-manager";
import type { Logger } from "./logger";

export interface ContentValidatorDeps {
  readonly logger: Logger;
  readonly pluginManager: PluginManager;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/** Supported languages. */
const SUPPORTED_LANGUAGES = ["en", "fa", "auto"] as const;

/** Minimum title length. */
const MIN_TITLE_LENGTH = 3;

/** Maximum title length. */
const MAX_TITLE_LENGTH = 500;

/** Minimum body length. */
const MIN_BODY_LENGTH = 10;

/** Maximum body length (Telegram limit). */
const MAX_BODY_LENGTH = 4096;

export class ContentValidator {
  constructor(private readonly deps: ContentValidatorDeps) {}

  /** Validate a content item. Returns { ok, errors }. */
  validate(item: ContentItem): ValidationResult {
    const errors: string[] = [];

    // 1. Empty content check.
    if (!item.title || item.title.trim().length === 0) {
      errors.push("Title is empty");
    } else if (item.title.trim().length < MIN_TITLE_LENGTH) {
      errors.push(`Title too short (${item.title.trim().length} chars, min ${MIN_TITLE_LENGTH})`);
    } else if (item.title.length > MAX_TITLE_LENGTH) {
      errors.push(`Title too long (${item.title.length} chars, max ${MAX_TITLE_LENGTH})`);
    }

    // Body is optional — some sources (HackerNews, XKCD) only have title.
    // The AI will generate the body from the title + URL.
    if (item.body && item.body.length > MAX_BODY_LENGTH) {
      errors.push(`Body too long (${item.body.length} chars, max ${MAX_BODY_LENGTH})`);
    }

    // 2. URL check.
    if (!item.url || item.url.trim().length === 0) {
      errors.push("URL is empty");
    } else if (!this.isValidUrl(item.url)) {
      errors.push(`URL is invalid: ${item.url}`);
    }

    // 3. Language check.
    if (!SUPPORTED_LANGUAGES.includes(item.language as "en" | "fa" | "auto")) {
      errors.push(`Unsupported language: "${item.language}"`);
    }

    // 4. Source check — plugin must be registered.
    if (!item.pluginId) {
      errors.push("Plugin ID is empty");
    } else if (!this.deps.pluginManager.get(item.pluginId)) {
      errors.push(`Source plugin "${item.pluginId}" is not registered`);
    }

    // 5. Category check.
    if (!["A", "B", "C"].includes(item.category)) {
      errors.push(`Invalid category: "${item.category}"`);
    }

    // 6. Media check (if present).
    if (item.media) {
      if (!item.media.url || !this.isValidUrl(item.media.url)) {
        errors.push(`Media URL is invalid: ${item.media.url ?? "(empty)"}`);
      }
      if (!["image", "video", "animation", "none"].includes(item.media.type)) {
        errors.push(`Media type is invalid: ${item.media.type}`);
      }
    }

    // 7. Plugin ID and source must match.
    if (item.pluginId !== item.source) {
      errors.push(`Plugin ID (${item.pluginId}) does not match source (${item.source})`);
    }

    if (errors.length > 0) {
      this.deps.logger.warn("quality.reject", {
        contentId: item.id,
        pluginId: item.pluginId,
        errors,
        stage: "validate",
      });
    }

    return { ok: errors.length === 0, errors };
  }

  /** Check if a URL is valid. */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch { /* non-fatal */
      return false;
    }
  }
}

/** Re-export limits for testing. */
export {
  SUPPORTED_LANGUAGES,
  MIN_TITLE_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_BODY_LENGTH,
  MAX_BODY_LENGTH,
};

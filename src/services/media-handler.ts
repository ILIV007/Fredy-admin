/**
 * src/services/media-handler.ts
 * Handles media (images, videos) for content items.
 *
 * NASA rules: image first, short caption, no long explanation.
 * See FREDY_GUIDELINES.md §6.3 (NASA), §8 (Image Rules).
 */

import type { ContentMedia, ContentItem } from "../types/content";
import type { Logger } from "./logger";

export interface MediaHandlerDeps {
  readonly logger: Logger;
}

/** Maximum image URL length. */
const MAX_URL_LENGTH = 2048;

/** Supported image URL patterns. */
const IMAGE_URL_PATTERNS = [
  /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)$/i,
  /^https?:\/\/.+(image|photo|img|cdn|static|assets|upload)/i,
  /^https?:\/\/apod\.nasa\.gov\//i,
  /^https?:\/\/.+(nasa|apod)/i,
];

export class MediaHandler {
  constructor(_deps: MediaHandlerDeps) {
    void _deps;
  }

  /** Validate a media URL. */
  validate(media: ContentMedia | null): { ok: boolean; reason?: string } {
    if (!media) return { ok: true }; // No media is valid.

    if (!media.url || media.url.length === 0) {
      return { ok: false, reason: "Media URL is empty" };
    }

    if (media.url.length > MAX_URL_LENGTH) {
      return { ok: false, reason: `Media URL too long (${media.url.length} chars)` };
    }

    try {
      const parsed = new URL(media.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, reason: `Unsupported protocol: ${parsed.protocol}` };
      }
    } catch {
      return { ok: false, reason: "Invalid URL format" };
    }

    return { ok: true };
  }

  /** Check if a content item should have media (e.g., NASA). */
  shouldHaveMedia(item: ContentItem): boolean {
    // NASA items should have media.
    if (item.pluginId === "nasa") return true;
    // Items with imageUrl in raw source.
    if (item.raw.imageUrl) return true;
    return false;
  }

  /** Extract media from a content item. */
  extractMedia(item: ContentItem): ContentMedia | null {
    // If the item already has media, return it.
    if (item.media) return item.media;

    // If the raw source has an image URL, use it.
    if (item.raw.imageUrl) {
      const media: ContentMedia = {
        type: "image",
        url: item.raw.imageUrl,
        alt: item.title,
      };
      return media;
    }

    return null;
  }

  /** Check if a media URL looks like a valid image. */
  isImageUrl(url: string): boolean {
    return IMAGE_URL_PATTERNS.some((pattern) => pattern.test(url));
  }

  /** Truncate a caption for NASA (short caption rule). */
  truncateCaption(caption: string, maxLength = 400): string {
    if (caption.length <= maxLength) return caption;
    // Truncate at the last word boundary before maxLength.
    const truncated = caption.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > maxLength * 0.8) {
      return truncated.slice(0, lastSpace) + "…";
    }
    return truncated + "…";
  }

  /** Build a NASA-style short caption. */
  buildNasaCaption(title: string, explanation: string, maxLength = 400): string {
    // NASA rule: image first, short caption, no long explanation.
    const caption = `${title}\n\n${explanation}`;
    return this.truncateCaption(caption, maxLength);
  }

  /** Detect the media type from a URL. */
  detectMediaType(url: string): ContentMedia["type"] {
    const lower = url.toLowerCase();
    if (lower.match(/\.(mp4|webm|mov|avi)$/)) return "video";
    if (lower.match(/\.(gif)$/)) return "animation";
    if (lower.match(/\.(jpg|jpeg|png|webp|svg)$/)) return "image";
    if (this.isImageUrl(url)) return "image";
    return "none";
  }
}

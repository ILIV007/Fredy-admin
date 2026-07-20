/**
 * src/types/api.ts
 * Content source API shapes. The shape plugins return from `fetch()`.
 */

import type { Category } from "./category";

/** A single raw item fetched from a content source, before AI processing. */
export interface SourceItem {
  /** Stable identifier for dedup (e.g., GitHub repo full_name, APOD date). */
  readonly id: string;

  /** The source plugin that produced this item. */
  readonly source: string;

  /** Category this item belongs to (must match the source's category). */
  readonly category: Category;

  /** Title or headline. */
  readonly title: string;

  /** Body text, description, or summary — raw from the API. */
  readonly body: string;

  /** Canonical URL to the original content. */
  readonly url: string;

  /** Language of the content (e.g., "en", "fa"). Defaults to "en". */
  readonly language?: string;

  /** When the content was originally published (epoch ms), if known. */
  readonly publishedAt?: number;

  /** Optional image URL (provider-supplied or resolved by MediaResolver). */
  readonly imageUrl?: string;

  /** Optional media (image/video) attached to the item. */
  readonly media?: SourceMedia;

  /** Optional metadata bag for source-specific fields. */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /** When the item was fetched. */
  readonly fetchedAt: number;

  // ─── v11.6.0: Provider Display Metadata ───
  // Populated by the provider's normalize() method from the manifest.
  // Carried through the pipeline to the formatter.

  /** Icon emoji for the footer (e.g., "☁️", "🐙"). */
  readonly displayIcon?: string;

  /** Display label (e.g., "Cloudflare Blog", "microsoft/vscode", or "Source" as fallback). */
  readonly displaySource?: string;
}

/** Media attached to a source item. */
export interface SourceMedia {
  readonly type: "image" | "video" | "animation" | "none";
  readonly url: string;
  readonly alt?: string;
  /** Where the media came from (provider, og:image, github-social, logo). */
  readonly source?: "provider" | "opengraph" | "github-social" | "logo" | "none";
}

/** Result of a source fetch operation. */
export interface FetchResult {
  readonly source: string;
  readonly ok: boolean;
  readonly items: readonly SourceItem[];
  readonly error?: string;
  readonly fetchedAt: number;
  readonly durationMs: number;
}

/** Health status for a source, shown in the admin panel and debug dashboard. */
export interface HealthStatus {
  readonly source: string;
  readonly healthy: boolean;
  readonly lastSuccessAt: number | null;
  readonly lastErrorAt: number | null;
  readonly lastErrorMessage: string | null;
  readonly consecutiveFailures: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetAt?: number;
}

/** Generic API response envelope (rarely used; most APIs have their own shape). */
export interface ApiResponse<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly status: number;
}

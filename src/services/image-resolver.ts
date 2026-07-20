/**
 * src/services/image-resolver.ts
 * v11.7.0: Unified Image Resolution Pipeline.
 *
 * Priority order:
 *   1. Provider-supplied image (from SourceItem.imageUrl/media)
 *   2. OpenGraph image (og:image meta tag)
 *   3. Twitter Card image (twitter:image meta tag)
 *   4. GitHub social preview (opengraph.githubassets.com)
 *   5. Dev.to API cover_image
 *   6. Reddit preview.images
 *
 * NO fallback logos — if no real image is found, return null (text-only post).
 * A low-quality placeholder is worse than no image.
 *
 * Cache: resolved images cached in KV (1h TTL) to avoid repeated page fetches.
 */

import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";
import type { SourceItem } from "../types/api";

export interface ImageResolverDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
}

export interface ResolvedImage {
  readonly url: string;
  readonly source: "provider" | "og:image" | "twitter:image" | "github-social" | "devto-api" | "reddit-preview";
  readonly width?: number;
  readonly height?: number;
}

const CACHE_PREFIX = "fredy:image:";
const CACHE_TTL_SECONDS = 3600; // 1 hour
const FETCH_TIMEOUT_MS = 8000;

export class ImageResolver {
  constructor(private readonly deps: ImageResolverDeps) {}

  /**
   * Resolve the best available image for a source item.
   * Returns null if no real image is found (no fallback logos).
   */
  async resolve(item: SourceItem): Promise<ResolvedImage | null> {
    // 1. Check cache first.
    const cacheKey = `${CACHE_PREFIX}${this.hashUrl(item.url)}`;
    const cached = await this.deps.kv.getJson<ResolvedImage>(cacheKey).catch(() => null);
    if (cached?.url) {
      this.deps.logger.info("pipeline.start", {
        stage: "image_resolver",
        source: cached.source,
        cached: true,
        message: "Image resolved from cache",
      });
      return cached;
    }

    // 2. Provider-supplied image.
    if (item.imageUrl && this.isValidImageUrl(item.imageUrl)) {
      const result: ResolvedImage = { url: item.imageUrl, source: "provider" };
      await this.cacheResult(cacheKey, result);
      return result;
    }

    // 3. Provider media.
    if (item.media?.url && item.media.type === "image" && this.isValidImageUrl(item.media.url)) {
      const result: ResolvedImage = { url: item.media.url, source: "provider" };
      await this.cacheResult(cacheKey, result);
      return result;
    }

    // 4. Reddit preview images.
    if (item.source === "reddit-v2" || item.source === "reddit") {
      const redditImage = this.extractRedditPreview(item);
      if (redditImage) {
        await this.cacheResult(cacheKey, redditImage);
        return redditImage;
      }
    }

    // 5. GitHub social preview.
    if (this.isGitHubUrl(item.url)) {
      const ghMatch = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(item.url);
      if (ghMatch) {
        const socialUrl = `https://opengraph.githubassets.com/1/${ghMatch[1]}/${ghMatch[2]}`;
        const result: ResolvedImage = { url: socialUrl, source: "github-social" };
        await this.cacheResult(cacheKey, result);
        return result;
      }
    }

    // 6. Dev.to API cover_image.
    if (item.url.includes("dev.to")) {
      const devtoImage = await this.fetchDevtoCover(item.url);
      if (devtoImage) {
        await this.cacheResult(cacheKey, devtoImage);
        return devtoImage;
      }
    }

    // 7. OpenGraph + Twitter Card from page HTML.
    const ogImage = await this.fetchOpenGraphImage(item.url);
    if (ogImage) {
      await this.cacheResult(cacheKey, ogImage);
      return ogImage;
    }

    // No image found — return null (text-only post, no ugly fallback).
    this.deps.logger.info("pipeline.start", {
      stage: "image_resolver",
      url: item.url,
      message: "No image found — post will be text-only",
    });
    return null;
  }

  /** Extract Reddit preview image from metadata. */
  private extractRedditPreview(item: SourceItem): ResolvedImage | null {
    const meta = item.metadata as Record<string, unknown> | undefined;
    if (!meta) return null;

    // Reddit JSON API: preview.images[0].source.url
    const preview = meta["preview"] as { images?: Array<{ source?: { url?: string; width?: number; height?: number } }> } | undefined;
    if (preview?.images?.[0]?.source?.url) {
      const url = preview.images[0].source.url;
      if (this.isValidImageUrl(url)) {
        return {
          url,
          source: "reddit-preview",
          width: preview.images[0].source.width,
          height: preview.images[0].source.height,
        };
      }
    }

    // Reddit thumbnail
    const thumbnail = meta["thumbnail"] as string | undefined;
    if (thumbnail && thumbnail.startsWith("http") && this.isValidImageUrl(thumbnail)) {
      return { url: thumbnail, source: "reddit-preview" };
    }

    return null;
  }

  /** Check if URL is a GitHub repo URL. */
  private isGitHubUrl(url: string): boolean {
    return /github\.com\/[^/]+\/[^/]+/i.test(url);
  }

  /** Fetch Dev.to article cover_image from API. */
  private async fetchDevtoCover(url: string): Promise<ResolvedImage | null> {
    const match = /dev\.to\/([^/]+)\/([^/?#]+)/i.exec(url);
    if (!match) return null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(`https://dev.to/api/articles/${match[1]}/${match[2]}`, {
        signal: controller.signal,
        headers: { "User-Agent": "FredyBot/1.0" },
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const article = await res.json() as { cover_image?: string };
      if (article.cover_image && this.isValidImageUrl(article.cover_image)) {
        return { url: article.cover_image, source: "devto-api" };
      }
    } catch { /* non-fatal */ }
    return null;
  }

  /** Fetch og:image and twitter:image from page HTML. */
  private async fetchOpenGraphImage(url: string): Promise<ResolvedImage | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      });
      clearTimeout(timeout);
      if (!res.ok) return null;

      const html = await res.text();

      // Try og:image first.
      const ogMatch = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html)
        ?? /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i.exec(html);
      if (ogMatch?.[1]) {
        const imgUrl = this.resolveRelativeUrl(ogMatch[1], url);
        if (imgUrl && this.isValidImageUrl(imgUrl)) {
          return { url: imgUrl, source: "og:image" };
        }
      }

      // Try twitter:image.
      const twMatch = /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i.exec(html)
        ?? /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i.exec(html);
      if (twMatch?.[1]) {
        const imgUrl = this.resolveRelativeUrl(twMatch[1], url);
        if (imgUrl && this.isValidImageUrl(imgUrl)) {
          return { url: imgUrl, source: "twitter:image" };
        }
      }

      // Try og:image:secure_url.
      const secureMatch = /<meta\s+property=["']og:image:secure_url["']\s+content=["']([^"']+)["']/i.exec(html);
      if (secureMatch?.[1]) {
        const imgUrl = this.resolveRelativeUrl(secureMatch[1], url);
        if (imgUrl && this.isValidImageUrl(imgUrl)) {
          return { url: imgUrl, source: "og:image" };
        }
      }
    } catch { /* non-fatal — timeout or fetch error */ }
    return null;
  }

  /** Validate image URL — must be http/https and not a known bad format. */
  private isValidImageUrl(url: string): boolean {
    if (!url || url.length < 10) return false;
    if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
    const lower = url.toLowerCase().split("?")[0] ?? "";
    // Reject non-image formats.
    if (lower.match(/\.(ico|gif|svg|bmp|tiff|html?|php|asp|jsp)$/)) return false;
    return true;
  }

  /** Resolve relative URLs against the page URL. */
  private resolveRelativeUrl(url: string, baseUrl: string): string | null {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  }

  /** Simple hash for cache key. */
  private hashUrl(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  /** Cache resolved image in KV. */
  private async cacheResult(cacheKey: string, result: ResolvedImage): Promise<void> {
    await this.deps.kv.setJson(cacheKey, result, CACHE_TTL_SECONDS).catch(() => {});
  }
}

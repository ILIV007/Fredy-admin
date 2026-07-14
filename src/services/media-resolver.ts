/**
 * src/services/media-resolver.ts
 * Media Resolver — selects the best image for a content item.
 *
 * Priority:
 *   1. Provider Image (item.media or item.imageUrl from the plugin)
 *   2. OpenGraph Image (fetched from the URL's <meta property="og:image">)
 *   3. GitHub Social Preview (for GitHub URLs: /opengraph image)
 *   4. Official Logo (provider homepage favicon/logo)
 *   5. No Image
 *
 * Never generates AI images.
 * Never stores images inside KV — only URLs or Telegram File IDs.
 *
 * See Prompt 10 spec.
 */

import type { SourceItem, SourceMedia } from "../types/api";
import type { Logger } from "./logger";

export interface MediaResolverDeps {
  readonly logger: Logger;
}

/** Fetch timeout for OG/logo requests. */
const FETCH_TIMEOUT_MS = 8_000;

export class MediaResolver {
  constructor(private readonly deps: MediaResolverDeps) {}

  /** Check if a URL points to an image Telegram can send as a photo. */
  private isUsableImage(url: string): boolean {
    return isUsableImageUrl(url);
  }

  /**
   * Resolve the best media for a source item.
   * Tries each priority in order, returns the first success.
   */
  async resolve(item: SourceItem): Promise<SourceMedia | null> {
    // 1. Provider Image.
    const providerImage = this.getProviderImage(item);
    if (providerImage) {
      this.deps.logger.debug("source.fetch_success", {
        contentId: item.id,
        mediaSource: "provider",
        url: providerImage.url,
      });
      return providerImage;
    }

    // 2. OpenGraph Image.
    const ogImage = await this.fetchOpenGraphImage(item.url);
    if (ogImage) {
      this.deps.logger.debug("source.fetch_success", {
        contentId: item.id,
        mediaSource: "opengraph",
        url: ogImage.url,
      });
      return ogImage;
    }

    // 3. GitHub Social Preview.
    if (this.isGitHubUrl(item.url)) {
      const ghSocial = this.getGitHubSocialPreview(item.url);
      if (ghSocial) {
        this.deps.logger.debug("source.fetch_success", {
          contentId: item.id,
          mediaSource: "github-social",
          url: ghSocial.url,
        });
        return ghSocial;
      }
    }

    // 4. Official Logo (provider homepage favicon).
    // Only use logos that are actual images (png, jpg, jpeg, webp).
    // Skip .ico, .gif, .svg — Telegram can't send them as photos.
    const logo = await this.fetchOfficialLogo(item.source);
    if (logo && this.isUsableImage(logo.url)) {
      this.deps.logger.debug("source.fetch_success", {
        contentId: item.id,
        mediaSource: "logo",
        url: logo.url,
      });
      return logo;
    }

    // 5. No Image.
    this.deps.logger.debug("source.fetch_success", {
      contentId: item.id,
      mediaSource: "none",
    });
    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Priority 1: Provider Image
  // ────────────────────────────────────────────────────────────

  /** Get the media provided by the plugin itself. */
  private getProviderImage(item: SourceItem): SourceMedia | null {
    if (item.media && item.media.url && this.isValidImageUrl(item.media.url)) {
      return {
        type: item.media.type,
        url: item.media.url,
        alt: item.media.alt ?? item.title,
        source: "provider",
      };
    }
    if (item.imageUrl && this.isValidImageUrl(item.imageUrl)) {
      return {
        type: this.detectMediaType(item.imageUrl),
        url: item.imageUrl,
        alt: item.title,
        source: "provider",
      };
    }
    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Priority 2: OpenGraph Image
  // ────────────────────────────────────────────────────────────

  /** Fetch the og:image meta tag from a URL. */
  private async fetchOpenGraphImage(url: string): Promise<SourceMedia | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Fredy/1.0 (Telegram Content Bot)" },
      });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const html = await response.text();
      const ogImage = this.extractOgImage(html);
      if (!ogImage) return null;

      // Resolve relative URLs.
      const absoluteUrl = this.resolveUrl(ogImage, url);
      if (!absoluteUrl || !this.isValidImageUrl(absoluteUrl)) return null;

      return {
        type: "image",
        url: absoluteUrl,
        alt: this.extractOgTitle(html) ?? "OpenGraph image",
        source: "opengraph",
      };
    } catch {
      return null;
    }
  }

  /** Extract og:image from HTML. */
  private extractOgImage(html: string): string | null {
    const match = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html);
    if (match) return match[1] ?? null;
    // Try reversed attribute order.
    const match2 = /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i.exec(html);
    return match2?.[1] ?? null;
  }

  /** Extract og:title from HTML. */
  private extractOgTitle(html: string): string | null {
    const match = /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(html);
    return match?.[1] ?? null;
  }

  // ────────────────────────────────────────────────────────────
  // Priority 3: GitHub Social Preview
  // ────────────────────────────────────────────────────────────

  /** Check if a URL is a GitHub URL. */
  private isGitHubUrl(url: string): boolean {
    return /github\.com\//i.test(url);
  }

  /** Get the GitHub social preview image URL for a repo. */
  private getGitHubSocialPreview(url: string): SourceMedia | null {
    // Extract owner/repo from URL: https://github.com/owner/repo
    const match = /github\.com\/([^/]+)\/([^/]+)/i.exec(url);
    if (!match) return null;
    const [, owner, repo] = match;
    // GitHub's social preview URL.
    const previewUrl = `https://opengraph.githubassets.com/1/${owner}/${repo}`;
    return {
      type: "image",
      url: previewUrl,
      alt: `${owner}/${repo} social preview`,
      source: "github-social",
    };
  }

  // ────────────────────────────────────────────────────────────
  // Priority 4: Official Logo
  // ────────────────────────────────────────────────────────────

  /** Fetch the official logo/favicon for a provider. */
  private async fetchOfficialLogo(sourceId: string): Promise<SourceMedia | null> {
    // Map source IDs to known logos.
    const logo = PROVIDER_LOGOS[sourceId];
    if (!logo) return null;

    return {
      type: "image",
      url: logo,
      alt: `${sourceId} logo`,
      source: "logo",
    };
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  /** Check if a URL is a valid image URL. */
  private isValidImageUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      // Also check file extension — reject .ico, .gif, .svg, .bmp, .tiff
      return isUsableImageUrl(url);
    } catch {
      return false;
    }
  }

  /** Detect media type from URL. */
  private detectMediaType(url: string): SourceMedia["type"] {
    const lower = url.toLowerCase();
    if (lower.match(/\.(mp4|webm|mov|avi)$/)) return "video";
    if (lower.match(/\.(gif)$/)) return "animation";
    if (lower.match(/\.(jpg|jpeg|png|webp|svg)$/)) return "image";
    return "image"; // default
  }

  /** Resolve a relative URL against a base. */
  private resolveUrl(relative: string, base: string): string | null {
    try {
      return new URL(relative, base).href;
    } catch {
      return null;
    }
  }
}

/** Official logos for known providers. */
const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  github: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
  news: "https://newsapi.org/images/n-logo-border.png",
  nasa: "https://www.nasa.gov/sites/all/themes/custom/nasatwo/images/nasa-logo.svg",
  joke: "https://v2.jokeapi.dev/favicon.ico",
  hackernews: "https://hn.ycombinator.com/y18.gif",
  devto: "https://dev.to/assets/devlogo-pwa-512.png",
  stackexchange: "https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon.png",
  reddit: "https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png",
  xkcd: "https://xkcd.com/s/0b7742.png",
  "github-releases": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
  "github-trending": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
  wikimedia: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Wikipedia-logo-v2.svg/200px-Wikipedia-logo-v2.svg.png",
};

/** Check if a URL points to an image Telegram can send as a photo.
 *  Telegram supports: jpg, jpeg, png, webp (not .ico, .gif, .svg). */
function isUsableImageUrl(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp") || !lower.match(/\.(ico|gif|svg|bmp|tiff)$/);
}

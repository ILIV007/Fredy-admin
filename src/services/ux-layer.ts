/**
 * src/services/ux-layer.ts
 * UX Layer — transforms ReadyContent into FinalPost for Telegram.
 *
 * Post format (simplified):
 *   <b>Hook (AI headline or title)</b>
 *
 *   Body (AI-generated text, full length, no truncation)
 *
 *   <blockquote>emoji Source — URL</blockquote>
 *   <blockquote>🌀 &#64;ILIVIR3</blockquote>
 *
 * For short posts (body < 200 chars), hook and body are combined into one paragraph.
 */

import type { ReadyContent, FinalPost } from "../types/content";
import type { UXLayer } from "./ux-layer";
import type { HookEngine } from "./hook-engine";
import type { SourceFormatter } from "./source-formatter";
import type { Logger } from "./logger";
import { TELEGRAM_TEXT_LIMIT, TELEGRAM_CAPTION_LIMIT } from "../core/constants";

export interface UXLayerDeps {
  readonly logger: Logger;
  readonly hookEngine: HookEngine;
  readonly sourceFormatter: SourceFormatter;
}

export class UXLayerImpl implements UXLayer {
  constructor(private readonly deps: UXLayerDeps) {}

  /** Transform a ReadyContent into a FinalPost. */
  async transform(content: ReadyContent): Promise<FinalPost> {
    // 1. Hook = AI headline (or fallback to title).
    const hook = (content.headline ?? content.text?.split("\n")[0] ?? "").trim();

    // 2. Body = AI text (full, no truncation, no URL stripping).
    //    If AI didn't run (format-only), body = content.text as-is.
    const body = (content.text ?? "").trim();

    // 3. Source line with random emoji.
    const { emoji } = await this.deps.sourceFormatter.buildFooter();

    // 4. Assemble the full text.
    const fullText = this.assembleFullText(hook, body, content.sourceUrl, emoji);

    // 5. Caption for image posts (shorter).
    const caption = this.assembleCaption(hook, body, content.sourceUrl, emoji);

    return {
      hook,
      body,
      takeaway: "",
      sourceLine: `${emoji} Source`,
      sourceEmoji: emoji,
      sourceUrl: content.sourceUrl,
      media: content.media,
      fullText: fullText.slice(0, TELEGRAM_TEXT_LIMIT),
      caption: caption.slice(0, TELEGRAM_CAPTION_LIMIT),
      language: content.language,
      category: content.category,
      score: content.quality.overallScore,
      internalMetadata: {
        contentId: content.id,
        pluginId: content.pluginId,
        aiProvider: content.aiProvider,
        aiModel: content.aiModel,
        tokensUsed: content.tokensUsed,
        estimatedCost: content.estimatedCost,
        qualityScore: content.quality.overallScore,
        processedAt: content.processedAt,
      },
    };
  }

  /** Assemble the full post text. */
  private assembleFullText(
    hook: string,
    body: string,
    sourceUrl: string,
    emoji: string,
  ): string {
    const parts: string[] = [];

    // Hook (bold) — only if different from body.
    if (hook && body && !body.startsWith(hook)) {
      parts.push(`<b>${this.escapeHtml(hook)}</b>`);
      parts.push("");
    }

    // Body (escaped HTML, full length, no truncation).
    parts.push(this.escapeHtml(body));

    // Source as blockquote — only for URLs with meaningful paths.
    if (sourceUrl && this.isLinkableUrl(sourceUrl)) {
      parts.push("");
      parts.push(`<blockquote><a href="${this.escapeHtml(sourceUrl)}">${emoji} Source</a></blockquote>`);
    }

    // Channel footer as blockquote.
    parts.push("");
    parts.push(`<blockquote>🌀 &#64;ILIVIR3</blockquote>`);

    return parts.join("\n");
  }

  /** Assemble a shorter caption for image posts. */
  private assembleCaption(
    hook: string,
    body: string,
    sourceUrl: string,
    emoji: string,
  ): string {
    const parts: string[] = [];

    // Hook (bold).
    if (hook && body && !body.startsWith(hook)) {
      parts.push(`<b>${this.escapeHtml(hook)}</b>`);
      parts.push("");
    }

    // Body — for captions, limit to 800 chars but don't add "...".
    const shortBody = body.length > 800 ? body.slice(0, 797) : body;
    parts.push(this.escapeHtml(shortBody));

    // Source as blockquote.
    if (sourceUrl && this.isLinkableUrl(sourceUrl)) {
      parts.push("");
      parts.push(`<blockquote><a href="${this.escapeHtml(sourceUrl)}">${emoji} Source</a></blockquote>`);
    }

    // Channel footer as blockquote.
    parts.push("");
    parts.push(`<blockquote>🌀 &#64;ILIVIR3</blockquote>`);

    return parts.join("\n");
  }

  /** Check if a URL has a meaningful path (not just "/"). */
  private isLinkableUrl(url: string): boolean {
    try {
      const u = new URL(url);
      const path = u.pathname;
      if (path === "/" || path === "" || path.length < 3) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Escape HTML special characters. */
  private escapeHtml(input: string | null | undefined): string {
    if (input === null || input === undefined) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}

// Re-export the class as UXLayer for backward compatibility.
export { UXLayerImpl as UXLayer };

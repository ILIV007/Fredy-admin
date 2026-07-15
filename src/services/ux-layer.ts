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
import { fixPersianHalfSpaces } from "../primitives/strings";

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
    // Apply Persian half-space fixing if language is fa.
    const fixedBody = content.language === "fa" ? fixPersianHalfSpaces(body) : body;

    // 3. Source line with random emoji.
    const { emoji } = await this.deps.sourceFormatter.buildFooter();

    // 4. Assemble the full text.
    const fullText = this.assembleFullText(hook, fixedBody, content.sourceUrl, emoji);

    // 5. Caption for image posts (shorter).
    const caption = this.assembleCaption(hook, fixedBody, content.sourceUrl, emoji);

    return {
      hook,
      body,
      takeaway: "",
      sourceLine: `${emoji} Source`,
      sourceEmoji: emoji,
      sourceUrl: content.sourceUrl,
      media: content.media,
      fullText: this.safeTruncate(fullText, TELEGRAM_TEXT_LIMIT),
      caption: this.safeTruncate(caption, TELEGRAM_CAPTION_LIMIT),
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

    // Body — convert AI markdown to HTML.
    parts.push(this.formatBody(body));

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

  /** Convert AI markdown to Telegram HTML.
   *  **bold** → <b>bold</b>
   *  > quote → <blockquote>quote</blockquote>
   *  >! collapsible → <blockquote expandable="true">collapsible</blockquote>
   */
  private formatBody(text: string): string {
    if (!text) return "";

    // 1. Escape HTML first.
    let html = this.escapeHtml(text);

    // 2. Convert **bold** to <b>bold</b>.
    html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

    // 3. Convert >! collapsible quotes to <blockquote expandable="true">.
    //    Lines starting with >! are collapsible.
    const lines = html.split("\n");
    const result: string[] = [];
    let inCollapsible = false;
    let collapsibleBuffer: string[] = [];

    for (const line of lines) {
      if (line.startsWith("&gt;! ")) {
        // Start or continuation of collapsible quote.
        if (!inCollapsible) {
          inCollapsible = true;
          collapsibleBuffer = [];
        }
        collapsibleBuffer.push(line.replace(/^&gt;! /, ""));
      } else if (line.startsWith("&gt;!")) {
        if (!inCollapsible) {
          inCollapsible = true;
          collapsibleBuffer = [];
        }
        collapsibleBuffer.push(line.replace(/^&gt;!/, ""));
      } else {
        // End of collapsible quote if we were in one.
        if (inCollapsible) {
          result.push(`<blockquote expandable="true">${collapsibleBuffer.join("\n")}</blockquote>`);
          inCollapsible = false;
          collapsibleBuffer = [];
        }
        result.push(line);
      }
    }
    // Don't forget trailing collapsible.
    if (inCollapsible && collapsibleBuffer.length > 0) {
      result.push(`<blockquote expandable="true">${collapsibleBuffer.join("\n")}</blockquote>`);
    }

    // 4. Convert > regular quotes to <blockquote>.
    //    Group consecutive > lines into a single blockquote.
    const finalResult: string[] = [];
    let inQuote = false;
    let quoteBuffer: string[] = [];

    for (const line of result) {
      if (line.startsWith("&gt; ") || line.startsWith("&gt;")) {
        const content = line.replace(/^&gt;\s?/, "");
        if (!inQuote) {
          inQuote = true;
          quoteBuffer = [];
        }
        quoteBuffer.push(content);
      } else {
        if (inQuote) {
          finalResult.push(`<blockquote>${quoteBuffer.join("\n")}</blockquote>`);
          inQuote = false;
          quoteBuffer = [];
        }
        finalResult.push(line);
      }
    }
    if (inQuote && quoteBuffer.length > 0) {
      finalResult.push(`<blockquote>${quoteBuffer.join("\n")}</blockquote>`);
    }

    return finalResult.join("\n");
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

    // Body — for captions, limit to 800 chars.
    const shortBody = body.length > 800 ? body.slice(0, 797) : body;
    parts.push(this.formatBody(shortBody));

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


  /** Truncate HTML text safely — closes any open tags. */
  private safeTruncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    let truncated = text.slice(0, maxLen);
    // Find last complete tag boundary.
    const lastTagStart = truncated.lastIndexOf("<");
    const lastTagEnd = truncated.lastIndexOf(">");
    if (lastTagStart > lastTagEnd) {
      // We're inside a tag — cut back to before it.
      truncated = truncated.slice(0, lastTagStart);
    }
    // Close any open tags.
    const openTags: string[] = [];
    const tagRegex = /<(\/?)(b|i|u|s|code|pre|blockquote|a)\b[^>]*>/gi;
    let match;
    while ((match = tagRegex.exec(truncated)) !== null) {
      const isClosing = match[1] === "/";
      const tag = match[2].toLowerCase();
      if (isClosing) {
        const idx = openTags.lastIndexOf(tag);
        if (idx >= 0) openTags.splice(idx, 1);
      } else {
        openTags.push(tag);
      }
    }
    // Close remaining open tags in reverse order.
    for (let i = openTags.length - 1; i >= 0; i--) {
      truncated += `</${openTags[i]}>`;
    }
    return truncated;
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

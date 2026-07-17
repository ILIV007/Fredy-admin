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
import { fixPersianHalfSpaces, escapeHtml } from "../primitives/strings";

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

    // 4. Assemble the full text — with body pre-truncated so source/footer always survive.
    //    v7.4.3: Previously, safeTruncate(fullText, 4096) was applied AFTER assembly,
    //    which meant long bodies could cut off the source blockquote and @ILIVIR3 footer.
    //    Now we compute the overhead (hook + source + footer) and truncate the BODY
    //    to fit within the limit, THEN assemble. Source and footer are ALWAYS present.
    const fullText = this.assembleFullText(hook, fixedBody, content.sourceUrl, emoji, TELEGRAM_TEXT_LIMIT);
    const caption = this.assembleCaption(hook, fixedBody, content.sourceUrl, emoji, TELEGRAM_CAPTION_LIMIT);

    return {
      hook,
      body,
      takeaway: "",
      sourceLine: `${emoji} Source`,
      sourceEmoji: emoji,
      sourceUrl: content.sourceUrl,
      media: content.media,
      fullText,
      caption,
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

  /** Assemble the full post text.
   *  v7.4.3: Now accepts a maxLen parameter and pre-truncates the BODY so
   *  that the source blockquote and @ILIVIR3 footer ALWAYS survive.
   *  Previously, the entire assembled text was truncated, which could cut
   *  off the source and footer when the body was long. */
  private assembleFullText(
    hook: string,
    body: string,
    sourceUrl: string,
    emoji: string,
    maxLen: number,
  ): string {
    // ── Step 1: Build the "overhead" (everything except the body) ──
    const overheadParts: string[] = [];

    // Hook (bold) — only if different from body.
    const hasHook = hook && body && !body.startsWith(hook);
    if (hasHook) {
      overheadParts.push(`<b>${escapeHtml(hook)}</b>`);
      overheadParts.push(""); // blank line after hook
    }

    // Source as blockquote — only for URLs with meaningful paths.
    const hasSource = sourceUrl && this.isLinkableUrl(sourceUrl);
    if (hasSource) {
      overheadParts.push("");
      overheadParts.push(`<blockquote><a href="${escapeHtml(sourceUrl)}">${emoji} Source</a></blockquote>`);
    }

    // Channel footer as blockquote.
    overheadParts.push("");
    overheadParts.push(`<blockquote>🌀 &#64;ILIVIR3</blockquote>`);

    // The overhead includes: hook + blank lines + source + footer.
    // The body sits between hook and source, preceded by nothing extra.
    // Total structure: [hook\n\n] [body] [\n\n source\n\n footer]
    const beforeBody = hasHook ? `<b>${escapeHtml(hook)}</b>\n\n` : "";
    const afterBody = (hasSource ? `\n\n<blockquote><a href="${escapeHtml(sourceUrl)}">${emoji} Source</a></blockquote>` : "")
      + `\n\n<blockquote>🌀 &#64;ILIVIR3</blockquote>`;

    const overheadLen = beforeBody.length + afterBody.length;
    const bodyBudget = maxLen - overheadLen;

    // ── Step 2: Truncate body to fit the budget ──
    let truncatedBody = body;
    if (bodyBudget > 0 && body.length > bodyBudget) {
      // Truncate the raw body (before HTML conversion) to leave room.
      // Reserve some extra chars for HTML tags that formatBody will add
      // (e.g., <b></b> = 7 chars per occurrence, <blockquote></blockquote> = 26 chars).
      const safetyMargin = 200; // generous buffer for HTML overhead
      const rawBudget = Math.max(100, bodyBudget - safetyMargin);
      truncatedBody = this.truncateRawText(body, rawBudget);
    }

    // ── Step 3: Convert (truncated) body to HTML ──
    const bodyHtml = this.formatBody(truncatedBody);

    // ── Step 4: Assemble final text ──
    const result = beforeBody + bodyHtml + afterBody;

    // ── Step 5: Final safety — if somehow still over limit, truncate the body HTML ──
    if (result.length > maxLen) {
      // Last resort: truncate everything but always keep source + footer.
      const footer = afterBody;
      const keepFooter = footer.length < maxLen;
      const bodyMax = maxLen - beforeBody.length - (keepFooter ? footer.length : 0);
      const safeBody = this.safeTruncate(bodyHtml, bodyMax > 100 ? bodyMax : 100);
      const finalText = beforeBody + safeBody + (keepFooter ? footer : "");
      return finalText;
    }

    return result;
  }

  /** Truncate raw (pre-HTML) text at a word/sentence boundary. */
  private truncateRawText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    // Try to cut at the last newline before maxLen (preserves paragraph structure).
    let cut = text.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen; // fallback to hard cut
    return text.slice(0, cut).trimEnd() + "\n\n…";
  }

  /** Convert AI markdown to Telegram HTML.
   *  **bold** → <b>bold</b>
   *  *italic* → <i>italic</i>
   *  `inline code` → <code>inline code</code>
   *  ```code block``` → <pre><code>code block</code></pre>
   *  > quote → <blockquote>quote</blockquote>
   *  >! collapsible → <blockquote expandable="true">collapsible</blockquote>
   *
   *  Code blocks/inline code are extracted FIRST (before escaping) so
   *  their content survives the escape step untouched.
   */
  private formatBody(text: string): string {
    if (!text) return "";

    // 1. Extract code blocks and inline code into placeholders so their
    //    content survives the escape step untouched.
    const codeSegments: string[] = [];
    let work = text;

    // Triple-backtick code blocks (may span multiple lines).
    work = work.replace(/```([\s\S]*?)```/g, (_, code: string) => {
      const escaped = escapeHtml(code.replace(/^\n/, "").replace(/\n$/, ""));
      codeSegments.push(`<pre><code>${escaped}</code></pre>`);
      return `__FREDY_CODE_${codeSegments.length - 1}__`;
    });

    // Single-backtick inline code (single line, no newlines inside).
    work = work.replace(/`([^`\n]+)`/g, (_, code: string) => {
      const escaped = escapeHtml(code);
      codeSegments.push(`<code>${escaped}</code>`);
      return `__FREDY_CODE_${codeSegments.length - 1}__`;
    });

    // 2. Escape HTML special chars in the remaining (non-code) text.
    let html = escapeHtml(work);

    // 3. Convert **bold** to <b>bold</b>.
    html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

    // 4. Convert *italic* to <i>italic</i> (single asterisks, not part of **).
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

    // 5. Convert >! collapsible quotes to <blockquote expandable="true">.
    const lines = html.split("\n");
    const result: string[] = [];
    let inCollapsible = false;
    let collapsibleBuffer: string[] = [];

    for (const line of lines) {
      if (line.startsWith("&gt;! ")) {
        if (!inCollapsible) { inCollapsible = true; collapsibleBuffer = []; }
        collapsibleBuffer.push(line.replace(/^&gt;! /, ""));
      } else if (line.startsWith("&gt;!")) {
        if (!inCollapsible) { inCollapsible = true; collapsibleBuffer = []; }
        collapsibleBuffer.push(line.replace(/^&gt;!/, ""));
      } else {
        if (inCollapsible) {
          result.push(`<blockquote expandable="true">${collapsibleBuffer.join("\n")}</blockquote>`);
          inCollapsible = false; collapsibleBuffer = [];
        }
        result.push(line);
      }
    }
    if (inCollapsible && collapsibleBuffer.length > 0) {
      result.push(`<blockquote expandable="true">${collapsibleBuffer.join("\n")}</blockquote>`);
    }

    // 6. Convert > regular quotes to <blockquote>.
    const finalResult: string[] = [];
    let inQuote = false;
    let quoteBuffer: string[] = [];

    for (const line of result) {
      // Skip lines that are already a <blockquote> tag.
      if (line.startsWith("<blockquote")) {
        if (inQuote) {
          finalResult.push(`<blockquote>${quoteBuffer.join("\n")}</blockquote>`);
          inQuote = false; quoteBuffer = [];
        }
        finalResult.push(line);
        continue;
      }
      if (line.startsWith("&gt; ") || line.startsWith("&gt;")) {
        const content = line.replace(/^&gt;\s?/, "");
        if (!inQuote) { inQuote = true; quoteBuffer = []; }
        quoteBuffer.push(content);
      } else {
        if (inQuote) {
          finalResult.push(`<blockquote>${quoteBuffer.join("\n")}</blockquote>`);
          inQuote = false; quoteBuffer = [];
        }
        finalResult.push(line);
      }
    }
    if (inQuote && quoteBuffer.length > 0) {
      finalResult.push(`<blockquote>${quoteBuffer.join("\n")}</blockquote>`);
    }

    // 7. Restore code segments.
    let finalHtml = finalResult.join("\n");
    finalHtml = finalHtml.replace(/__FREDY_CODE_(\d+)__/g, (_, i: string) => codeSegments[Number(i)] ?? "");

    return finalHtml;
  }

  /** Assemble a shorter caption for image posts.
   *  v7.4.3: Now uses the same pre-truncation pattern as assembleFullText
   *  so source + footer always survive, even for long bodies. */
  private assembleCaption(
    hook: string,
    body: string,
    sourceUrl: string,
    emoji: string,
    maxLen: number,
  ): string {
    const hasHook = hook && body && !body.startsWith(hook);
    const hasSource = sourceUrl && this.isLinkableUrl(sourceUrl);

    const beforeBody = hasHook ? `<b>${escapeHtml(hook)}</b>\n\n` : "";
    const afterBody = (hasSource ? `\n\n<blockquote><a href="${escapeHtml(sourceUrl)}">${emoji} Source</a></blockquote>` : "")
      + `\n\n<blockquote>🌀 &#64;ILIVIR3</blockquote>`;

    const overheadLen = beforeBody.length + afterBody.length;
    const bodyBudget = maxLen - overheadLen;

    // For captions, always limit body to 800 chars (was the old behavior).
    // But now we ensure source + footer always fit.
    const captionBodyLimit = Math.min(bodyBudget > 0 ? bodyBudget : 800, 800);
    let shortBody = body;
    if (body.length > captionBodyLimit) {
      const safetyMargin = 200;
      const rawBudget = Math.max(100, captionBodyLimit - safetyMargin);
      shortBody = this.truncateRawText(body, rawBudget);
    }

    const bodyHtml = this.formatBody(shortBody);
    const result = beforeBody + bodyHtml + afterBody;

    if (result.length > maxLen) {
      const bodyMax = maxLen - beforeBody.length - afterBody.length;
      const safeBody = this.safeTruncate(bodyHtml, bodyMax > 100 ? bodyMax : 100);
      return beforeBody + safeBody + afterBody;
    }

    return result;
  }

  /** Check if a URL has a meaningful path (not just "/"). */
  private isLinkableUrl(url: string): boolean {
    try {
      const u = new URL(url);
      const path = u.pathname;
      if (path === "/" || path === "" || path.length < 3) return false;
      return true;
    } catch { /* non-fatal */
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
      const tag = (match[2] ?? "").toLowerCase();
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

  // escapeHtml is imported from primitives/strings.ts — single source of truth.
}

// Re-export the class as UXLayer for backward compatibility.
export { UXLayerImpl as UXLayer };

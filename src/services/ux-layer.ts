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

    // v11.6.0: Source line uses provider display metadata from ReadyContent.
    // No hardcoded logic — the provider decides how it appears.
    // v11.6.1: When displaySource is "Source" (generic fallback), use a random
    // emoji from the pool instead of the provider's fixed icon. This keeps the
    // classic Fredy behavior for providers that don't have a custom label.
    let displayIcon: string;
    const displaySource = content.displaySource ?? "Source";
    if (displaySource === "Source") {
      // Generic "Source" label — use random emoji from pool (classic behavior).
      const { emoji: randomEmoji } = await this.deps.sourceFormatter.buildFooter();
      displayIcon = randomEmoji;
    } else {
      // Provider has a custom label — use its icon.
      displayIcon = content.displayIcon ?? content.sourceEmoji ?? "🌌";
    }
    const sourceLine = `${displayIcon} ${displaySource}`;

    // 4. Assemble the full text.
    const fullText = this.assembleFullText(hook, fixedBody, content.sourceUrl, displayIcon, displaySource, TELEGRAM_TEXT_LIMIT);

    // 5. Caption for image posts (shorter).
    const caption = this.assembleCaption(hook, fixedBody, content.sourceUrl, displayIcon, displaySource, TELEGRAM_CAPTION_LIMIT);

    return {
      hook,
      body,
      takeaway: "",
      sourceLine,
      sourceEmoji: displayIcon,
      displayIcon,
      displaySource,
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
   *  v8.0.0: Pre-truncates the body to fit within maxLen — try full first,
   *  only truncate if the assembled text exceeds the limit.
   *  v11.6.0: Uses displaySource for the footer label. */
  private assembleFullText(
    hook: string,
    body: string,
    sourceUrl: string,
    emoji: string,
    displaySource: string,
    maxLen: number,
  ): string {
    // First, try the full body — most posts fit within the Telegram limit.
    const fullAttempt = this.buildFullTextParts(hook, body, sourceUrl, emoji, displaySource);
    if (fullAttempt.length <= maxLen) {
      return fullAttempt;
    }

    // Need to truncate the body. Reserve space for hook + footer + overhead.
    const footer = this.buildFooter(sourceUrl, emoji, displaySource);
    const hookBlock = this.buildHookBlock(hook, body);
    const overhead = hookBlock.length + footer.length + 4; // newlines + safety margin
    const bodyBudget = Math.max(200, maxLen - overhead);

    const truncatedBody = this.summarizeText(body, bodyBudget);
    return this.buildFullTextParts(hook, truncatedBody, sourceUrl, emoji, displaySource);
  }

  /** Build the full text parts (helper used by assembleFullText). */
  private buildFullTextParts(hook: string, body: string, sourceUrl: string, emoji: string, displaySource: string): string {
    const parts: string[] = [];
    if (hook && body && !body.startsWith(hook)) {
      parts.push(`<b>${escapeHtml(hook)}</b>`);
      parts.push("");
    }
    parts.push(this.formatBody(body));
    parts.push(...this.buildFooterParts(sourceUrl, emoji, displaySource));
    return parts.join("\n");
  }

  /** Build the hook block (used for overhead calculation). */
  private buildHookBlock(hook: string, body: string): string {
    if (hook && body && !body.startsWith(hook)) {
      return `<b>${escapeHtml(hook)}</b>\n\n`;
    }
    return "";
  }

  /** Build the footer string. */
  private buildFooter(sourceUrl: string, emoji: string, displaySource: string): string {
    return this.buildFooterParts(sourceUrl, emoji, displaySource).join("\n");
  }

  /** Build the footer parts array.
   *  v11.6.0: Uses displaySource instead of hardcoded "Source". */
  private buildFooterParts(sourceUrl: string, emoji: string, displaySource: string): string[] {
    const parts: string[] = [];
    const label = `${emoji} ${escapeHtml(displaySource)}`;
    if (sourceUrl && this.isLinkableUrl(sourceUrl)) {
      parts.push("");
      parts.push(`<blockquote><a href="${escapeHtml(sourceUrl)}">${label}</a></blockquote>`);
    }
    parts.push("");
    parts.push(`<blockquote>🌀 &#64;ILIVIR3</blockquote>`);
    return parts;
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
   *  v8.0.0: Pre-truncates the body to fit within maxLen.
   *  v11.6.0: Uses displaySource for the footer label. */
  private assembleCaption(
    hook: string,
    body: string,
    sourceUrl: string,
    emoji: string,
    displaySource: string,
    maxLen: number,
  ): string {
    // First, try the full body — most captions fit within the limit.
    const fullAttempt = this.buildCaptionParts(hook, body, sourceUrl, emoji, displaySource);
    if (fullAttempt.length <= maxLen) {
      return fullAttempt;
    }

    // Need to truncate the body. Reserve space for hook + footer + overhead.
    const footer = this.buildFooter(sourceUrl, emoji, displaySource);
    const hookBlock = this.buildHookBlock(hook, body);
    const overhead = hookBlock.length + footer.length + 4;
    const bodyBudget = Math.max(150, maxLen - overhead);

    const truncatedBody = this.summarizeText(body, bodyBudget);
    return this.buildCaptionParts(hook, truncatedBody, sourceUrl, emoji, displaySource);
  }

  /** Build caption parts (helper).
   *  v11.6.0: Uses displaySource for the footer label. */
  private buildCaptionParts(hook: string, body: string, sourceUrl: string, emoji: string, displaySource: string): string {
    const parts: string[] = [];
    if (hook && body && !body.startsWith(hook)) {
      parts.push(`<b>${escapeHtml(hook)}</b>`);
      parts.push("");
    }
    parts.push(this.formatBody(body));
    parts.push(...this.buildFooterParts(sourceUrl, emoji, displaySource));
    return parts.join("\n");
  }

  /** Summarize text to fit within maxLen.
   *  Truncates at paragraph boundary first, then sentence, then word.
   *  v11.6.2: Never cuts inside a code block. No "…" marker (user doesn't want it). */
  private summarizeText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;

    const target = Math.max(20, maxLen);

    // v11.6.2: Check if we're inside a code block at the target position.
    // If so, extend to the end of the code block or skip it entirely.
    const beforeTarget = text.slice(0, target);
    const codeBlockStarts = (beforeTarget.match(/```/g) ?? []).length;
    // Odd number of ``` means we're inside a code block — find the closing ```
    if (codeBlockStarts % 2 === 1) {
      const closingIndex = text.indexOf("```", target);
      if (closingIndex !== -1 && closingIndex < maxLen + 2000) {
        // Include the full code block
        const fullBlockEnd = text.indexOf("\n", closingIndex + 3);
        if (fullBlockEnd !== -1) {
          return text.slice(0, fullBlockEnd);
        }
      }
      // Can't fit the code block — cut before it starts
      const lastCodeBlockStart = beforeTarget.lastIndexOf("```");
      if (lastCodeBlockStart > 0) {
        const beforeCode = text.slice(0, lastCodeBlockStart).trimEnd();
        if (beforeCode.length > 50) return beforeCode;
      }
    }

    // Try paragraph boundary first (double newline).
    const paragraphs = text.split(/\n\n+/);
    if (paragraphs.length > 1) {
      let result = "";
      for (const para of paragraphs) {
        const candidate = result ? `${result}\n\n${para}` : para;
        if (candidate.length <= target) {
          result = candidate;
        } else {
          break;
        }
      }
      if (result.length > 0 && result.length < text.length) {
        return result;
      }
    }

    // Try sentence boundary.
    const sentenceEnd = text.lastIndexOf(". ", target);
    const exclEnd = text.lastIndexOf("! ", target);
    const questEnd = text.lastIndexOf("? ", target);
    const bestSentence = Math.max(sentenceEnd, exclEnd, questEnd);
    if (bestSentence > target * 0.5) {
      return text.slice(0, bestSentence + 1);
    }

    // Fall back to word boundary.
    const wordEnd = text.lastIndexOf(" ", target);
    if (wordEnd > target * 0.5) {
      return text.slice(0, wordEnd);
    }

    // Last resort: hard cut.
    return text.slice(0, target);
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

  // escapeHtml is imported from primitives/strings.ts — single source of truth.
}

// Re-export the class as UXLayer for backward compatibility.
export { UXLayerImpl as UXLayer };

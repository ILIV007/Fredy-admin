/**
 * src/services/ux-layer.ts
 * Humanizes the post format. Removes all system traces.
 *
 * Rules (Prompt 13):
 *   - Human-like writing
 *   - No robotic structure
 *   - No metadata visible (scores, API names, system traces)
 *   - No long paragraphs (max 2-5 lines body)
 *   - Max readability priority
 *
 * Final structure:
 *   [HOOK]
 *   [BODY: 2-5 lines]
 *   [TAKEAWAY]
 *   [SOURCE LINE]
 */

import type { ReadyContent, FinalPost, ContentMedia } from "../types/content";
import type { HookEngine } from "./hook-engine";
import type { SourceFormatter } from "./source-formatter";
import type { Logger } from "./logger";
import { TELEGRAM_TEXT_LIMIT, TELEGRAM_CAPTION_LIMIT } from "../core/constants";

export interface UXLayerDeps {
  readonly logger: Logger;
  readonly hookEngine: HookEngine;
  readonly sourceFormatter: SourceFormatter;
}

/** Maximum body lines. */
const MAX_BODY_LINES = 5;

/** Maximum body characters. */
const MAX_BODY_CHARS = 600;

export class UXLayer {
  constructor(private readonly deps: UXLayerDeps) {}

  /** Transform a ReadyContent into a FinalPost. */
  async transform(content: ReadyContent): Promise<FinalPost> {
    // 1. Generate a dynamic hook.
    const hook = this.deps.hookEngine.generate(content);

    // 2. Humanize the body (strip metadata, shorten, restructure).
    const body = this.humanizeBody(content.text);

    // 3. Extract a key takeaway.
    const takeaway = this.extractTakeaway(content.text, content.category);

    // 4. Build the source line.
    const { emoji, footer } = await this.deps.sourceFormatter.buildFooter();

    // 5. Assemble the full text.
    const fullText = this.assembleFullText(hook, body, takeaway, footer, content.sourceUrl);

    // 6. Build a shorter caption for image posts.
    const caption = this.assembleCaption(hook, body, takeaway, footer);

    return {
      hook,
      body,
      takeaway,
      sourceLine: footer,
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

  /** Humanize the body: strip metadata, shorten, clean up. */
  private humanizeBody(text: string | null | undefined): string {
    if (!text) return "";
    let body = text;

    // Remove any visible metadata patterns.
    body = this.stripMetadata(body);

    // Remove AI cliché phrases.
    body = this.stripCliches(body);

    // Split into paragraphs and keep only the first few.
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, MAX_BODY_LINES);

    // Join with double newlines.
    body = paragraphs.join("\n\n");

    // Limit total length.
    if (body.length > MAX_BODY_CHARS) {
      body = body.slice(0, MAX_BODY_CHARS - 3) + "...";
    }

    return body;
  }

  /** Strip visible metadata (scores, API names, system traces). */
  private stripMetadata(text: string | null | undefined): string {
    if (!text) return "";
    let cleaned = text;

    // Remove patterns like "Score: 85", "Quality: 90/100".
    cleaned = cleaned.replace(/(?:score|quality)\s*:\s*\d+(?:\s*\/\s*100)?/gi, "");

    // Remove API names (openrouter, gemini, etc.) when they appear as metadata.
    cleaned = cleaned.replace(/\b(?:provider|model)\s*:\s*\S+/gi, "");

    // Remove "Source: @xxx" attribution tags.
    cleaned = cleaned.replace(/via\s+@\w+/gi, "");
    cleaned = cleaned.replace(/source\s*:\s*@\w+/gi, "");

    // Remove "Join/Follow/Subscribe" promo lines.
    cleaned = cleaned.replace(/\b(?:join|subscribe|follow)\s+(?:us\s+)?(?:on\s+)?(?:telegram\s+)?@?\w+/gi, "");

    // Remove excessive hashtags (5+ consecutive).
    cleaned = cleaned.replace(/(?:#\w+\s*){5,}/g, "");

    // Clean up extra whitespace.
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

    return cleaned;
  }

  /** Remove AI cliché phrases. */
  private stripCliches(text: string | null | undefined): string {
    if (!text) return "";
    const cliches = [
      /in today's world,?/gi,
      /it is worth noting that?/gi,
      /as an ai(?:\s+language\s+model)?,?/gi,
      /in this (?:article|post),? (?:we|i) (?:will|'ll)?/gi,
      /let'?s dive in,?/gi,
      /without further ado,?/gi,
      /here'?s (?:the |a )?(?:thing|catch|twist)\s*:/gi,
    ];

    let cleaned = text;
    for (const cliche of cliches) {
      cleaned = cleaned.replace(cliche, "");
    }

    // Clean up double spaces left by removals.
    cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

    return cleaned;
  }

  /** Extract a key takeaway line from the body. */
  private extractTakeaway(text: string | null | undefined, category: string): string {
    if (!text) return "";
    const sentences = text
      .split(/[.!?]\s/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15 && s.length < 150);

    if (sentences.length === 0) return "";

    // For Category A (dev), look for "how to" or benefit sentences.
    if (category === "A") {
      const benefit = sentences.find((s) =>
        /(?:you can|lets you|allows you|makes it|helps you|enables)/i.test(s),
      );
      if (benefit) return this.cleanTakeaway(benefit);
    }

    // For Category B (news), look for impact sentences.
    if (category === "B") {
      const impact = sentences.find((s) =>
        /(?:means|matters|affects|impacts|changes)/i.test(s),
      );
      if (impact) return this.cleanTakeaway(impact);
    }

    // For Category C, use the last sentence as takeaway.
    if (category === "C") {
      return this.cleanTakeaway(sentences[sentences.length - 1]!);
    }

    // Fallback: use the second sentence (first is usually the hook context).
    return this.cleanTakeaway(sentences[1] ?? sentences[0] ?? "");
  }

  /** Clean a takeaway sentence. */
  private cleanTakeaway(sentence: string | null | undefined): string {
    if (!sentence) return "";
    let cleaned = sentence.trim();
    if (!cleaned) return "";
    // Ensure it ends with a period.
    if (!/[.!?]$/.test(cleaned)) cleaned += ".";
    // Limit length.
    if (cleaned.length > 120) {
      cleaned = cleaned.slice(0, 117) + "...";
    }
    return cleaned;
  }

  /** Assemble the full post text. */
  private assembleFullText(
    hook: string,
    body: string,
    takeaway: string,
    sourceFooter: string,
    sourceUrl: string,
  ): string {
    const parts: string[] = [];

    // Hook (bold).
    parts.push(`<b>${this.escapeHtml(hook)}</b>`);
    parts.push("");

    // Body.
    parts.push(body);

    // Takeaway (italic, if present).
    if (takeaway) {
      parts.push("");
      parts.push(`<i>${this.escapeHtml(takeaway)}</i>`);
    }

    // Source link (blockquote).
    if (sourceUrl) {
      parts.push("");
      parts.push(`<blockquote>${sourceUrl}</blockquote>`);
    }

    // Source footer.
    parts.push("");
    parts.push(sourceFooter);

    // Channel footer.
    parts.push("🌀 @ILIVIR3");

    return parts.join("\n");
  }

  /** Assemble a shorter caption for image posts. */
  private assembleCaption(
    hook: string,
    body: string,
    takeaway: string,
    sourceFooter: string,
  ): string {
    const parts: string[] = [];

    // Hook (bold).
    parts.push(`<b>${this.escapeHtml(hook)}</b>`);
    parts.push("");

    // Body (shortened more aggressively).
    const shortBody = body.length > 300 ? body.slice(0, 297) + "..." : body;
    parts.push(shortBody);

    // Takeaway (if room).
    if (takeaway && parts.join("\n").length < 800) {
      parts.push("");
      parts.push(`<i>${this.escapeHtml(takeaway)}</i>`);
    }

    // Source footer.
    parts.push("");
    parts.push(sourceFooter);

    return parts.join("\n");
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

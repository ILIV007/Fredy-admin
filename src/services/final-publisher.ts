/**
 * src/services/final-publisher.ts
 * Final Publishing Engine — converts ReadyContent into FinalPost and publishes to Telegram.
 *
 * Pipeline (Prompt 13):
 *   ReadyContent → UX Layer (hook + humanize) → FinalPost → Telegram Publisher
 *
 * Quality Gate (HARD RULE):
 *   If score < 60 → reject, do NOT publish, move to next content.
 *
 * Failure Handling:
 *   1. Retry once (max 2 retries total)
 *   2. If fail again → log error, skip post, continue queue
 *
 * Publishing:
 *   - sendMessage (text posts)
 *   - sendPhoto (media posts)
 *   - HTML formatting
 *   - Safe link handling (blockquote)
 */

import type { ReadyContent, FinalPost } from "../types/content";
import type { PublishResult } from "../types/scheduler";
import type { UXLayer } from "./ux-layer";
import type { PublishValidator } from "./publish-validator";
import type { RetryManager } from "./retry-manager";
import type { HistoryService } from "./history-service";
import type { TelegramService } from "./telegram";
import type { FredySettings } from "../types/config";
import type { Logger } from "./logger";
import { PublishFailedError } from "../core/scheduler/errors";

export interface FinalPublisherDeps {
  readonly tg: TelegramService;
  readonly uxLayer: UXLayer;
  readonly validator: PublishValidator;
  readonly retryManager: RetryManager;
  readonly history: HistoryService;
  readonly logger: Logger;
  readonly settings: () => Promise<FredySettings>;
}

/** Max retries (max 2 retries). */
const MAX_RETRIES = 2;

export class FinalPublisher {
  /** Debug info from last publish attempt (for error reporting). */
  public _lastPublishDebug: Record<string, unknown> | null = null;

  constructor(private readonly deps: FinalPublisherDeps) {}

  /** Full pipeline: ReadyContent → UX Layer → Telegram. */
  async publish(content: ReadyContent): Promise<PublishResult> {
    const startTime = Date.now();
    const settings = await this.deps.settings();
    const minScore = settings.ai.qualityThreshold;

    // ── Quality Gate (HARD RULE) ────────────────────────────
    if (content.quality.overallScore < minScore) {
      this.deps.logger.warn("quality.reject", {
        contentId: content.id,
        score: content.quality.overallScore,
        minScore,
        message: "Quality gate: score below threshold, skipping",
      });
      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: `Quality score ${content.quality.overallScore} < ${minScore}`,
        attempts: 0,
      };
    }

    // ── Publish Validation ──────────────────────────────────
    const validation = await this.deps.validator.validate(content);
    if (!validation.ok) {
      this.deps.logger.warn("quality.reject", {
        contentId: content.id,
        reasons: validation.reasons,
        message: "Publish validation failed",
      });
      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: validation.reasons.join("; "),
        attempts: 0,
      };
    }

    // ── UX Layer: transform to FinalPost ───────────────────
    const finalPost = await this.deps.uxLayer.transform(content);

    this.deps.logger.info("pipeline.start", {
      contentId: content.id,
      hook: finalPost.hook,
      category: finalPost.category,
      hasMedia: !!finalPost.media,
      score: finalPost.score,
      message: "Final post assembled",
    });

    // ── Publish to Telegram with retry ──────────────────────
    const retryResult = await this.deps.retryManager.execute(
      () => this.publishToTelegram(finalPost),
      { maxRetries: MAX_RETRIES },
    );

    if (!retryResult.ok || !retryResult.value) {
      // All retries failed — log, skip, continue.
      const error = retryResult.error ?? "Unknown error";
      
      // Capture debug info for the error report.
      const cleanText = this.stripBareUrls(finalPost.fullText);
      this._lastPublishDebug = {
        error,
        fullText: finalPost.fullText,
        cleanText,
        cleanTextLength: cleanText.length,
        hasUrl: /https?:\/\//i.test(cleanText),
        hasHref: /<a\s+href/i.test(cleanText),
        hasAtMention: /@[a-zA-Z]/.test(cleanText),
        channel: settings?.telegram?.targetChannel ?? "@ILIVIR3",
        parseMode: settings?.telegram?.parseMode ?? "HTML",
        sourceUrl: content.sourceUrl,
        contentText: content.text,
        contentTextLength: content.text?.length ?? 0,
        headline: content.headline,
        hook: finalPost.hook,
        body: finalPost.body,
        takeaway: finalPost.takeaway,
        fullPostKeys: Object.keys(finalPost),
        hasMedia: !!finalPost.media,
        mediaType: finalPost.media?.type,
        mediaUrl: finalPost.media?.url,
        caption: finalPost.caption,
        retryAttempts: retryResult.attempts,
      };
      
      this.deps.logger.error("telegram.error", {
        contentId: content.id,
        error,
        attempts: retryResult.attempts,
        message: "Publish failed after retries, skipping post",
      });

      // Record failure in history.
      await this.deps.history.recordFailed(content, error);

      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error,
        attempts: retryResult.attempts,
      };
    }

    const { messageId, chatId } = retryResult.value;

    // ── Record success in history ───────────────────────────
    await this.deps.history.recordPublished(content, messageId, chatId);

    this.deps.logger.info("telegram.send", {
      contentId: content.id,
      hook: finalPost.hook,
      messageId,
      chatId,
      attempts: retryResult.attempts,
      durationMs: Date.now() - startTime,
      message: "Published successfully",
    });

    return {
      ok: true,
      contentId: content.id,
      category: content.category,
      telegramMessageId: messageId,
      telegramChatId: chatId,
      publishedAt: Date.now(),
      attempts: retryResult.attempts,
    };
  }

  /** Publish a FinalPost to Telegram (text or photo). */
  private async publishToTelegram(
    post: FinalPost,
  ): Promise<{ messageId: number; chatId: string }> {
    const settings = await this.deps.settings();
    const channel = settings?.telegram?.targetChannel ?? "@ILIVIR3";
    const parseMode = settings?.telegram?.parseMode ?? "HTML";

    // CRITICAL: Strip ALL bare URLs from text before sending to Telegram.
    const cleanText = this.stripBareUrls(post.fullText);
    const cleanCaption = this.stripBareUrls(post.caption || "");

    // EXTENSIVE DEBUG: log everything about the message.
    console.log("[publish] ====== PUBLISH DEBUG ======");
    console.log("[publish] post.fullText:", JSON.stringify(post.fullText));
    console.log("[publish] post.caption:", JSON.stringify(post.caption));
    console.log("[publish] cleanText:", JSON.stringify(cleanText));
    console.log("[publish] cleanCaption:", JSON.stringify(cleanCaption));
    console.log("[publish] cleanText length:", cleanText.length);
    console.log("[publish] channel:", channel);
    console.log("[publish] parseMode:", parseMode);
    console.log("[publish] has <a href:", /<a\s+href/i.test(cleanText));
    console.log("[publish] has bare URL:", /https?:\/\//i.test(cleanText));
    console.log("[publish] has <blockquote:", /<blockquote/i.test(cleanText));
    console.log("[publish] has <b>:", /<b>/i.test(cleanText));
    console.log("[publish] has <i>:", /<i>/i.test(cleanText));
    console.log("[publish] has <code>:", /<code>/i.test(cleanText));
    console.log("[publish] has <pre>:", /<pre>/i.test(cleanText));
    // Check for unbalanced HTML tags
    const tagCounts = ["b", "i", "u", "s", "code", "pre", "blockquote", "a"];
    for (const tag of tagCounts) {
      const opens = (cleanText.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
      const closes = (cleanText.match(new RegExp(`</${tag}>`, "gi")) || []).length;
      if (opens !== closes) {
        console.log(`[publish] UNBALANCED <${tag}>: ${opens} opens, ${closes} closes`);
      }
    }
    console.log("[publish] ====== END DEBUG ======");

    // If content has media (image), send as photo with caption.
    // FINAL SAFETY: check that media URL is a usable image format.
    if (post.media && post.media.type === "image" && post.media.url) {
      const mediaUrl = post.media.url.toLowerCase().split("?")[0] ?? "";
      if (mediaUrl.match(/\.(ico|gif|svg|bmp|tiff)$/)) {
        // Bad image format — send as text-only instead.
        console.log("[publish] Skipping media (bad format):", mediaUrl);
      } else {
        const result = await this.deps.tg.sendPhoto(
          channel,
          post.media.url,
          cleanCaption,
          {
            parse_mode: parseMode,
          },
        );

        if (!result.ok || !result.result) {
          throw new Error(`Telegram sendPhoto failed: ${result.description ?? "unknown"} (error_code: ${result.error_code ?? "?"})`);
        }

        return {
          messageId: result.result.message_id,
          chatId: String(result.result.chat?.id ?? channel),
        };
      }
    }

    // Text-only post.
    // NOTE: Do NOT send disable_web_page_preview — it causes Telegram to
    // validate @username mentions in the text as web pages, returning
    // "wrong type of the web page content". Since we've stripped ALL URLs
    // from the text, there's nothing to preview anyway.
    const result = await this.deps.tg.sendMessage(channel, cleanText, {
      parse_mode: parseMode,
    });

    if (!result.ok || !result.result) {
      throw new Error(`Telegram sendMessage failed: ${result.description ?? "unknown"} (error_code: ${result.error_code ?? "?"})`);
    }

    return {
      messageId: result.result.message_id,
      chatId: String(result.result.chat?.id ?? channel),
    };
  }

  /** Simulate publishing (for debug/testing — no Telegram call). */
  async simulate(content: ReadyContent): Promise<{ finalPost: FinalPost; wouldPublish: boolean }> {
    const settings = await this.deps.settings();
    const minScore = settings.ai.qualityThreshold;
    // Quality gate check.
    if (content.quality.overallScore < minScore) {
      const finalPost = await this.deps.uxLayer.transform(content);
      return { finalPost, wouldPublish: false };
    }

    const finalPost = await this.deps.uxLayer.transform(content);
    return { finalPost, wouldPublish: true };
  }

  /** Strip bare URLs from text, preserving <a href="URL">text</a> links. */
  private stripBareUrls(text: string): string {
    // 1. Extract <a href="URL">text</a> tags and replace with placeholders.
    const links: string[] = [];
    let work = text.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match) => {
      links.push(match);
      return `\x00LINK${links.length - 1}\x00`;
    });
    // 2. Strip ALL remaining bare URLs.
    work = work.replace(/https?:\/\/[^\s<>"'\x00]+/gi, "");
    // 3. Restore <a> tags.
    work = work.replace(/\x00LINK(\d+)\x00/g, (_, i) => links[Number(i)] || "");
    // 4. Clean up extra whitespace.
    return work.replace(/\n{3,}/g, "\n\n").trim();
  }
}

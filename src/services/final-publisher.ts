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

/** Quality gate threshold. */
const MIN_SCORE = 60;

/** Max retries (Prompt 13: max 2 retries). */
const MAX_RETRIES = 2;

export class FinalPublisher {
  constructor(private readonly deps: FinalPublisherDeps) {}

  /** Full pipeline: ReadyContent → UX Layer → Telegram. */
  async publish(content: ReadyContent): Promise<PublishResult> {
    const startTime = Date.now();

    // ── Quality Gate (HARD RULE) ────────────────────────────
    if (content.quality.overallScore < MIN_SCORE) {
      this.deps.logger.warn("quality.reject", {
        contentId: content.id,
        score: content.quality.overallScore,
        minScore: MIN_SCORE,
        message: "Quality gate: score below threshold, skipping",
      });
      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: `Quality score ${content.quality.overallScore} < ${MIN_SCORE}`,
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
    const channel = settings.telegram.targetChannel;
    const parseMode = settings.telegram.parseMode;

    // Sanitize HTML to prevent 400 errors.
    const safeFullText = this.sanitizeHtml(post.fullText);
    const safeCaption = this.sanitizeHtml(post.caption);

    // If content has media (image), send as photo with caption.
    if (post.media && post.media.type === "image" && post.media.url) {
      const result = await this.deps.tg.sendPhoto(
        channel, post.media.url, safeCaption,
        { parse_mode: parseMode, disable_web_page_preview: true },
      );
      if (!result.ok || !result.result) {
        throw new Error(`Telegram sendPhoto failed: ${result.description ?? "unknown"}`);
      }
      return { messageId: result.result.message_id, chatId: String(result.result.chat?.id ?? channel) };
    }

    // Text-only post.
    const result = await this.deps.tg.sendMessage(channel, safeFullText, {
      parse_mode: parseMode, disable_web_page_preview: true,
    });
    if (!result.ok || !result.result) {
      throw new Error(`Telegram sendMessage failed: ${result.description ?? "unknown"}`);
    }
    return { messageId: result.result.message_id, chatId: String(result.result.chat?.id ?? channel) };
  }

  /** Sanitize HTML: remove unbalanced/empty tags, fix nested blockquotes. */
  private sanitizeHtml(html: string): string {
    let r = html;
    r = r.replace(/<(b|i|u|s|code|pre|blockquote)>\s*<\/\1>/gi, "");
    r = r.replace(/<blockquote>([^<]*?)<blockquote>/g, "$1");
    r = r.replace(/<\/blockquote>([^<]*?)<\/blockquote>/g, "$1</blockquote>");
    const tags = ["b", "i", "u", "s", "code", "pre", "blockquote", "a"];
    for (const tag of tags) {
      const openRegex = tag === "a" ? /<a\s/g : new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g");
      const open = (r.match(openRegex) || []).length;
      const close = (r.match(new RegExp(`</${tag}>`, "g")) || []).length;
      if (open > close) r += `</${tag}>`.repeat(open - close);
    }
    if (r.length > 4096) r = r.slice(0, 4090) + "…";
    return r;
  }

  /** Simulate publishing (for debug/testing — no Telegram call). */
  async simulate(content: ReadyContent): Promise<{ finalPost: FinalPost; wouldPublish: boolean }> {
    // Quality gate check.
    if (content.quality.overallScore < MIN_SCORE) {
      const finalPost = await this.deps.uxLayer.transform(content);
      return { finalPost, wouldPublish: false };
    }

    const finalPost = await this.deps.uxLayer.transform(content);
    return { finalPost, wouldPublish: true };
  }
}

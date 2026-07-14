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

    // CRITICAL: Strip ALL raw URLs from the text before sending.
    // Telegram tries to preview URLs even with disable_web_page_preview:true,
    // and returns "wrong type of the web page content" for API endpoints.
    // We keep <a href="URL">text</a> links (those are fine) but strip bare URLs.
    const cleanText = post.fullText.replace(/(?<!href=")https?:\/\/[^\s<>"']+/gi, (match) => {
      // If this URL is inside an href attribute, keep it.
      // The negative lookbehind handles most cases.
      return "";
    }).replace(/\n{3,}/g, "\n\n").trim();

    const cleanCaption = (post.caption || "").replace(/(?<!href=")https?:\/\/[^\s<>"']+/gi, "").replace(/\n{3,}/g, "\n\n").trim();

    // If content has media (image), send as photo with caption.
    if (post.media && post.media.type === "image" && post.media.url) {
      const result = await this.deps.tg.sendPhoto(
        channel,
        post.media.url,
        cleanCaption,
        {
          parse_mode: parseMode,
          disable_web_page_preview: true,
        },
      );

      if (!result.ok || !result.result) {
        throw new Error(`Telegram sendPhoto failed: ${result.description ?? "unknown"}`);
      }

      return {
        messageId: result.result.message_id,
        chatId: String(result.result.chat?.id ?? channel),
      };
    }

    // Text-only post.
    const result = await this.deps.tg.sendMessage(channel, cleanText, {
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });

    if (!result.ok || !result.result) {
      throw new Error(`Telegram sendMessage failed: ${result.description ?? "unknown"}`);
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
}

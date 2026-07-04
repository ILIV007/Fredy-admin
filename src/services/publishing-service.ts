/**
 * src/services/publishing-service.ts
 * Telegram publishing service.
 *
 * Supports: text, image, caption, markdown (HTML), links.
 * Uses RetryManager for Telegram failures.
 *
 * See Prompt 9 spec.
 */

import type { ReadyContent } from "../types/content";
import type { PublishResult } from "../types/scheduler";
import type { Category } from "../types/category";
import type { TelegramService } from "./telegram";
import type { PublishValidator } from "./publish-validator";
import type { RetryManager } from "./retry-manager";
import type { HistoryService } from "./history-service";
import type { FredySettings } from "../types/config";
import type { Logger } from "./logger";
import { PublishFailedError, PublishValidationError } from "../core/scheduler/errors";
import { TELEGRAM_TEXT_LIMIT, TELEGRAM_CAPTION_LIMIT } from "../core/constants";

export interface PublishingServiceDeps {
  readonly tg: TelegramService;
  readonly validator: PublishValidator;
  readonly retryManager: RetryManager;
  readonly history: HistoryService;
  readonly logger: Logger;
  readonly settings: () => Promise<FredySettings>;
}

export class PublishingService {
  constructor(private readonly deps: PublishingServiceDeps) {}

  /** Publish a ReadyContent to Telegram. */
  async publish(content: ReadyContent): Promise<PublishResult> {
    const startTime = Date.now();

    // 1. Validate before publishing.
    const validation = await this.deps.validator.validate(content);
    if (!validation.ok) {
      throw new PublishValidationError(
        `Publish validation failed: ${validation.reasons.join("; ")}`,
        validation.reasons,
      );
    }

    // 2. Build the publish payload.
    const settings = await this.deps.settings();
    const channel = settings.telegram.targetChannel;
    const parseMode = settings.telegram.parseMode;
    const disablePreview = settings.telegram.disableWebPagePreview;

    // 3. Publish with retry.
    const retryResult = await this.deps.retryManager.execute(async () => {
      return this.publishToTelegram(content, channel, parseMode, disablePreview);
    });

    if (!retryResult.ok || !retryResult.value) {
      // All retries failed — record in history as failed.
      await this.deps.history.recordFailed(content, retryResult.error ?? "Unknown error");
      throw new PublishFailedError(content.id, retryResult.attempts, retryResult.error ?? "Unknown error");
    }

    const messageResult = retryResult.value;
    const messageId = messageResult.messageId;
    const chatId = messageResult.chatId;

    // 4. Record in history.
    await this.deps.history.recordPublished(content, messageId, chatId);

    const result: PublishResult = {
      ok: true,
      contentId: content.id,
      category: content.category,
      telegramMessageId: messageId,
      telegramChatId: chatId,
      publishedAt: Date.now(),
      attempts: retryResult.attempts,
    };

    this.deps.logger.info("telegram.send", {
      contentId: content.id,
      category: content.category,
      messageId,
      chatId,
      attempts: retryResult.attempts,
      durationMs: Date.now() - startTime,
      message: "Published successfully",
    });

    return result;
  }

  /** Publish to Telegram — handles text vs image+caption. */
  private async publishToTelegram(
    content: ReadyContent,
    channel: string,
    parseMode: "HTML" | "MarkdownV2",
    disablePreview: boolean,
  ): Promise<{ messageId: number; chatId: string }> {
    const text = this.buildPostText(content);

    // If content has media (image), send as photo with caption.
    if (content.media && content.media.type === "image" && content.media.url) {
      const caption = this.buildCaption(content);
      const result = await this.deps.tg.sendPhoto(
        channel,
        content.media.url,
        caption,
        {
          parse_mode: parseMode,
          disable_web_page_preview: disablePreview,
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
    const result = await this.deps.tg.sendMessage(channel, text, {
      parse_mode: parseMode,
      disable_web_page_preview: disablePreview,
    });

    if (!result.ok || !result.result) {
      throw new Error(`Telegram sendMessage failed: ${result.description ?? "unknown"}`);
    }

    return {
      messageId: result.result.message_id,
      chatId: String(result.result.chat?.id ?? channel),
    };
  }

  /** Build the full post text: body + source footer + channel footer. */
  private buildPostText(content: ReadyContent): string {
    const parts: string[] = [];

    // Headline (if present).
    if (content.headline) {
      parts.push(`<b>${this.escapeHtml(content.headline)}</b>`);
      parts.push("");
    }

    // Body text.
    parts.push(content.text);

    // Source link (in blockquote).
    if (content.sourceUrl) {
      parts.push("");
      parts.push(`<blockquote>${content.sourceUrl}</blockquote>`);
    }

    // Source footer ([emoji]Source).
    parts.push("");
    parts.push(content.sourceFooter);

    // Channel footer.
    parts.push("🌀 @ILIVIR3");

    return parts.join("\n").slice(0, TELEGRAM_TEXT_LIMIT);
  }

  /** Build a short caption for image posts (NASA). */
  private buildCaption(content: ReadyContent): string {
    const parts: string[] = [];

    // Title.
    if (content.headline) {
      parts.push(`<b>${this.escapeHtml(content.headline)}</b>`);
      parts.push("");
    }

    // Body (truncated for caption limit).
    parts.push(content.text.slice(0, TELEGRAM_CAPTION_LIMIT - 200));

    // Source footer.
    parts.push("");
    parts.push(content.sourceFooter);

    return parts.join("\n").slice(0, TELEGRAM_CAPTION_LIMIT);
  }

  /** Escape HTML special characters. */
  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Publish a simple text message (for admin tests). */
  async publishText(text: string): Promise<PublishResult> {
    const settings = await this.deps.settings();
    const channel = settings.telegram.targetChannel;
    const result = await this.deps.tg.sendMessage(channel, text, {
      parse_mode: settings.telegram.parseMode,
    });

    if (!result.ok || !result.result) {
      return {
        ok: false,
        contentId: null,
        category: null,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: result.description ?? "Unknown error",
        attempts: 1,
      };
    }

    return {
      ok: true,
      contentId: null,
      category: null,
      telegramMessageId: result.result.message_id,
      telegramChatId: String(result.result.chat?.id ?? channel),
      publishedAt: Date.now(),
      attempts: 1,
    };
  }
}

/** Re-export Category for convenience. */
export type { Category };

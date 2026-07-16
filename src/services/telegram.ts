/**
 * src/services/telegram.ts
 * Telegram Bot API client. Real implementation.
 *
 * Ported from AI Admin src/telegram.js, refactored to a class with injected
 * dependencies. Adds AbortController timeouts on every call (ARCHITECTURE_RULES §21.13),
 * chat_id resolution cache, scheduling permission checks, and the publishToChannel
 * dispatcher that picks the right API method per media type.
 */

import { TELEGRAM_API_BASE, TELEGRAM_TEXT_LIMIT, TELEGRAM_CAPTION_LIMIT } from "../core/constants";
import { TelegramApiError } from "../core/errors";
import type {
  ExtractedContent,
  InlineKeyboard,
  TelegramChat,
  TelegramMessage,
  TelegramResult,
  TelegramUpdate,
  TelegramUser,
} from "../types/telegram";

export interface TelegramServiceDeps {
  readonly botToken: string;
  readonly webhookSecret?: string;
}

/** Per-call timeout. Telegram allows up to 60s but we fail faster. */
const CALL_TIMEOUT_MS = 15_000;

/** Cached chat_id resolution (in-memory, per isolate). */
const chatIdCache = new Map<string, number>();

/** Cached bot ID (per isolate). */
let cachedBotId: number | null = null;

export class TelegramService {
  constructor(private readonly deps: TelegramServiceDeps) {}

  // ────────────────────────────────────────────────────────────
  // Messaging
  // ────────────────────────────────────────────────────────────

  /** Send a text message. Returns the Telegram API response. */
  async sendMessage(
    chatId: number | string,
    text: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...extra,
    });
  }

  /** Send a photo by file_id or URL. */
  async sendPhoto(
    chatId: number | string,
    photo: string,
    caption?: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
      ...extra,
    });
  }

  /** Send a video by file_id or URL. */
  async sendVideo(
    chatId: number | string,
    video: string,
    caption?: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("sendVideo", {
      chat_id: chatId,
      video,
      caption,
      ...extra,
    });
  }

  /** Send an animation (GIF) by file_id or URL. */
  async sendAnimation(
    chatId: number | string,
    animation: string,
    caption?: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("sendAnimation", {
      chat_id: chatId,
      animation,
      caption,
      ...extra,
    });
  }

  /** Send a document by file_id or URL. */
  async sendDocument(
    chatId: number | string,
    document: string,
    caption?: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("sendDocument", {
      chat_id: chatId,
      document,
      caption,
      ...extra,
    });
  }

  /** Send a media group (album). */
  async sendMediaGroup(
    chatId: number | string,
    media: readonly Readonly<Record<string, unknown>>[],
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<readonly TelegramMessage[]>> {
    return this.callApi<readonly TelegramMessage[]>("sendMediaGroup", {
      chat_id: chatId,
      media,
      ...extra,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Editing
  // ────────────────────────────────────────────────────────────

  /** Edit the text of a message. */
  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...extra,
    });
  }

  /** Edit the reply markup (inline keyboard) of a message. */
  async editMessageReplyMarkup(
    chatId: number | string,
    messageId: number,
    replyMarkup: InlineKeyboard,
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  /** Edit the caption of a media message. */
  async editMessageCaption(
    chatId: number | string,
    messageId: number,
    caption: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<TelegramResult<TelegramMessage>> {
    return this.callApi<TelegramMessage>("editMessageCaption", {
      chat_id: chatId,
      message_id: messageId,
      caption,
      ...extra,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Callbacks & actions
  // ────────────────────────────────────────────────────────────

  /** Answer a callback query (closes the loading spinner, shows toast). */
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<TelegramResult<boolean>> {
    return this.callApi<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  /** Send a chat action (typing..., uploading...). Best-effort, never throws. */
  async sendChatAction(
    chatId: number | string,
    action: "typing" | "upload_photo" | "upload_video" | "record_video" | "record_audio" = "typing",
  ): Promise<void> {
    try {
      await this.callApi<boolean>("sendChatAction", { chat_id: chatId, action });
    } catch { /* non-fatal */
      // Chat action failures are not user-visible; swallow.
    }
  }

  // ────────────────────────────────────────────────────────────
  // Bot & chat info
  // ────────────────────────────────────────────────────────────

  /** Get bot info. Result is cached per-isolate. */
  async getMe(): Promise<TelegramResult<TelegramUser>> {
    if (cachedBotId !== null) {
      return {
        ok: true,
        result: {
          id: cachedBotId,
          is_bot: true,
          first_name: "Fredy",
        },
      };
    }
    const result = await this.callApi<TelegramUser>("getMe", {});
    if (result.ok && result.result) {
      cachedBotId = result.result.id;
    }
    return result;
  }

  /** Get the bot's own ID (cached). Returns null on failure. */
  async getBotId(): Promise<number | null> {
    if (cachedBotId !== null) return cachedBotId;
    const me = await this.getMe();
    return me.ok && me.result ? me.result.id : null;
  }

  /** Get a chat by ID or username. */
  async getChat(chatId: number | string): Promise<TelegramResult<TelegramChat>> {
    return this.callApi<TelegramChat>("getChat", { chat_id: chatId });
  }

  /** Get a chat member's info (used for permission checks). */
  async getChatMember(
    chatId: number | string,
    userId: number,
  ): Promise<TelegramResult<{ user: TelegramUser; status: string; can_post_messages?: boolean }>> {
    return this.callApi("getChatMember", { chat_id: chatId, user_id: userId });
  }

  // ────────────────────────────────────────────────────────────
  // Webhook management
  // ────────────────────────────────────────────────────────────

  /** Set the webhook. */
  async setWebhook(url: string, secretToken?: string): Promise<TelegramResult<boolean>> {
    return this.callApi<boolean>("setWebhook", {
      url,
      secret_token: secretToken,
    });
  }

  /** Delete the webhook. */
  async deleteWebhook(): Promise<TelegramResult<boolean>> {
    return this.callApi<boolean>("deleteWebhook", {});
  }

  /** Verify the webhook secret header. */
  verifyWebhookSecret(headerValue: string | null): boolean {
    if (!this.deps.webhookSecret) return true; // not configured, skip check
    return headerValue === this.deps.webhookSecret;
  }

  // ────────────────────────────────────────────────────────────
  // Chat ID resolution & scheduling permissions
  // ────────────────────────────────────────────────────────────

  /**
   * Resolve a @username or numeric chat_id to a numeric chat_id.
   * Telegram's schedule_date only works with numeric IDs.
   * Result is cached per-isolate.
   */
  async resolveChatId(chatIdOrUsername: string | number): Promise<number | string> {
    // If it's already numeric, return as-is.
    if (typeof chatIdOrUsername === "number") return chatIdOrUsername;
    if (/^-?\d+$/.test(chatIdOrUsername)) return Number(chatIdOrUsername);

    // If it doesn't start with @, return as-is (Telegram accepts raw usernames too).
    if (!chatIdOrUsername.startsWith("@")) return chatIdOrUsername;

    // Check cache.
    const cached = chatIdCache.get(chatIdOrUsername);
    if (cached !== undefined) return cached;

    // Resolve via getChat.
    const result = await this.getChat(chatIdOrUsername);
    if (result.ok && result.result && typeof result.result.id === "number") {
      chatIdCache.set(chatIdOrUsername, result.result.id);
      return result.result.id;
    }
    // Resolution failed — return the original (Telegram may still accept it).
    return chatIdOrUsername;
  }

  /** Invalidate the chat_id cache for a username (used when scheduling fails mysteriously). */
  invalidateChatIdCache(chatIdOrUsername: string): void {
    chatIdCache.delete(chatIdOrUsername);
  }

  /**
   * Check whether the bot has permission to post and schedule messages in a channel.
   * Returns a structured permission report.
   */
  async checkSchedulingPermissions(
    channel: string,
    botId: number,
  ): Promise<{
    ok: boolean;
    status: string | null;
    canPostMessages: boolean;
    error?: string;
    rawPermissions?: Readonly<Record<string, unknown>>;
  }> {
    try {
      const resolved = await this.resolveChatId(channel);
      const member = await this.getChatMember(resolved, botId);
      if (!member.ok || !member.result) {
        return {
          ok: false,
          status: null,
          canPostMessages: false,
          error: member.description ?? "getChatMember failed",
        };
      }
      const status = member.result.status;
      const canPost = member.result.can_post_messages ?? (status === "administrator");
      return {
        ok: canPost,
        status,
        canPostMessages: canPost,
        rawPermissions: member.result as unknown as Readonly<Record<string, unknown>>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: null,
        canPostMessages: false,
        error: message,
      };
    }
  }

  /**
   * Verify that a Telegram API response actually scheduled a message.
   * Telegram sometimes returns ok:true but sends immediately, dropping schedule_date.
   * Returns whether the message was truly scheduled + the reason for the verdict.
   */
  verifyScheduled(
    response: TelegramResult<TelegramMessage>,
    scheduleDateUnix: number,
  ): { scheduled: boolean; reason: string; diffSeconds?: number } {
    if (!response.ok || !response.result) {
      return { scheduled: false, reason: "API call failed" };
    }
    const messageDate = response.result.date;
    if (!messageDate) {
      return { scheduled: false, reason: "no date in response" };
    }
    const diffSeconds = messageDate - scheduleDateUnix;
    // If the message date is within 60s of the scheduled date, it was scheduled.
    // If it's close to "now" (i.e., much earlier than scheduled), it was sent immediately.
    if (Math.abs(diffSeconds) < 60) {
      return { scheduled: true, reason: "message date matches schedule_date", diffSeconds };
    }
    if (diffSeconds < -60) {
      return {
        scheduled: false,
        reason: "message date is in the past — Telegram sent immediately",
        diffSeconds,
      };
    }
    return { scheduled: true, reason: "message date is in the future", diffSeconds };
  }

  // ────────────────────────────────────────────────────────────
  // Publishing
  // ────────────────────────────────────────────────────────────

  /**
   * Publish a post to a channel. Picks the right API method based on media type.
   * Used by the pipeline and the cron scheduler.
   */
  async publishToChannel(
    channel: string | number,
    post: {
      readonly text: string;
      readonly mediaType?: "photo" | "video" | "animation" | "document" | "none";
      readonly mediaFileId?: string | null;
      readonly mediaUrl?: string | null;
      readonly extra?: Readonly<Record<string, unknown>>;
    },
  ): Promise<TelegramResult<TelegramMessage>> {
    const resolvedChannel = await this.resolveChatId(channel);
    const extra = post.extra ?? {};
    const mediaType = post.mediaType ?? "none";

    if (mediaType === "none" || !post.mediaFileId) {
      // Text-only post.
      return this.sendMessage(resolvedChannel, post.text, extra);
    }

    // Media post: send media with caption.
    const media = post.mediaFileId;
    const caption = post.text.slice(0, TELEGRAM_CAPTION_LIMIT);

    if (mediaType === "photo") {
      return this.sendPhoto(resolvedChannel, media, caption, extra);
    }
    if (mediaType === "video") {
      return this.sendVideo(resolvedChannel, media, caption, extra);
    }
    if (mediaType === "animation") {
      return this.sendAnimation(resolvedChannel, media, caption, extra);
    }
    if (mediaType === "document") {
      return this.sendDocument(resolvedChannel, media, caption, extra);
    }
    // Fallback: text only.
    return this.sendMessage(resolvedChannel, post.text, extra);
  }

  // ────────────────────────────────────────────────────────────
  // Update extraction
  // ────────────────────────────────────────────────────────────

  /** Extract content from a Telegram update into Fredy's internal shape. */
  extractContent(update: TelegramUpdate): ExtractedContent | null {
    const message = update.message ?? update.edited_message ?? update.channel_post;
    if (!message) return null;

    const chatId = message.chat?.id;
    const fromId = message.from?.id ?? message.sender_chat?.id;
    if (!chatId || !fromId) return null;

    let mediaType: ExtractedContent["mediaType"] = "none";
    let mediaFileId: string | null = null;

    if (message.photo && message.photo.length > 0) {
      mediaType = "photo";
      // Pick the largest photo.
      mediaFileId = message.photo[message.photo.length - 1]?.file_id ?? null;
    } else if (message.video) {
      mediaType = "video";
      mediaFileId = message.video.file_id;
    } else if (message.animation) {
      mediaType = "animation";
      mediaFileId = message.animation.file_id;
    } else if (message.document) {
      mediaType = "document";
      mediaFileId = message.document.file_id;
    }

    return {
      chatId,
      fromId,
      chatType: message.chat?.type ?? "private",
      text: message.text ?? message.caption ?? "",
      mediaType,
      mediaFileId,
      mediaGroupId: message.media_group_id ?? null,
      replyToMessage: message.reply_to_message ?? null,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Internal API caller
  // ────────────────────────────────────────────────────────────

  /** Call a Telegram Bot API method with timeout and error handling. */
  private async callApi<T>(
    method: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<TelegramResult<T>> {
    const url = `${TELEGRAM_API_BASE}${this.deps.botToken}/${method}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

    // Strip undefined/null values — Telegram rejects them.
    // Also convert string "true"/"false" to actual booleans for known boolean fields.
    const cleanPayload: Record<string, unknown> = {};
    const booleanFields = new Set(["disable_web_page_preview", "disable_notification", "allow_sending_without_reply", "protect_content"]);
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (booleanFields.has(key)) {
        // Ensure boolean type — Telegram rejects strings for these fields.
        if (value === "true" || value === true) {
          cleanPayload[key] = true;
        } else if (value === "false" || value === false) {
          cleanPayload[key] = false;
        } else {
          cleanPayload[key] = Boolean(value);
        }
      } else {
        cleanPayload[key] = value;
      }
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanPayload),
        signal: controller.signal,
      });
      const data = (await response.json()) as TelegramResult<T>;
      // If Telegram returned an error, throw a structured error so callers can catch.
      if (!data.ok && data.error_code) {
        throw new TelegramApiError(method, data.error_code, data.description ?? "Unknown error", cleanPayload);
      }
      return data;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("abort")) {
        throw new TelegramApiError(method, undefined, `Request timeout after ${CALL_TIMEOUT_MS}ms`, cleanPayload);
      }
      throw new TelegramApiError(method, undefined, `Network error: ${message}`, cleanPayload);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Re-export the text/caption limits for callers that need them. */
export { TELEGRAM_TEXT_LIMIT, TELEGRAM_CAPTION_LIMIT };

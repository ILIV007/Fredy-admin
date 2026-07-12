/**
 * src/types/telegram.ts
 * Telegram update/message types. Subset of the Bot API we use.
 * Not a full re-implementation — only what Fredy needs.
 */

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
  readonly callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly date: number;
  readonly chat: TelegramChat;
  readonly from?: TelegramUser;
  readonly text?: string;
  readonly caption?: string;
  readonly photo?: readonly TelegramPhotoSize[];
  readonly video?: TelegramVideo;
  readonly animation?: TelegramAnimation;
  readonly document?: TelegramDocument;
  readonly media_group_id?: string;
  readonly reply_to_message?: TelegramMessage;
  readonly entities?: readonly TelegramEntity[];
}

export interface TelegramChat {
  readonly id: number;
  readonly type: "private" | "group" | "supergroup" | "channel";
  readonly title?: string;
  readonly username?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

export interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export interface TelegramPhotoSize {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly file_size?: number;
}

export interface TelegramVideo {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
}

export interface TelegramAnimation {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
}

export interface TelegramDocument {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramEntity {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly url?: string;
  readonly user?: TelegramUser;
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly message?: TelegramMessage;
  readonly inline_message_id?: string;
  readonly chat_instance?: string;
  readonly data?: string;
  readonly game_short_name?: string;
}

/** Inline keyboard structure Fredy builds for the admin panel. */
export interface InlineKeyboard {
  readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

export interface InlineKeyboardButton {
  readonly text: string;
  readonly callback_data: string;
  readonly url?: string;
}

/** Result of a Telegram API call. */
export interface TelegramResult<T = unknown> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
  readonly error_code?: number;
}

/** Extracted content from a Telegram update — Fredy's internal shape. */
export interface ExtractedContent {
  readonly chatId: number;
  readonly fromId: number;
  readonly chatType: TelegramChat["type"];
  readonly text: string;
  readonly mediaType: "photo" | "video" | "animation" | "document" | "none";
  readonly mediaFileId: string | null;
  readonly mediaGroupId: string | null;
  readonly replyToMessage: TelegramMessage | null;
}

/**
 * src/orchestrators/admin.ts
 * Admin panel orchestrator. Routes Telegram updates to the screen/command
 * registries.
 *
 * Callback routing:
 *   "menu:<id>"       → navigate to screen <id>, render it
 *   "back"            → navigate to main screen
 *   "toggle:approve"  → flip approve mode (special)
 *   "toggle:botEnabled" → flip bot enabled (special)
 *   "set:<scope>:..." → delegate to current screen's onCallback
 *   "action:<name>:..." → delegate to current screen's onCallback
 *   "<screenId>:<action>" → delegate to screen <screenId>'s onCallback
 */

import type { Container } from "../types/env";
import type { FredySettings } from "../types/config";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../types/telegram";
import { ScreenRegistry, CommandRegistry } from "../admin/registry";
import type { CommandContext, Screen, ScreenAction, ScreenContext } from "../admin/registry";
import { registerScreens } from "../admin/screens/register";
import { registerCommands } from "../admin/commands/register";
import { unauthorizedMessage } from "../admin/helpers/auth";

export class AdminOrchestrator {
  readonly screens = new ScreenRegistry();
  readonly commands = new CommandRegistry();

  constructor(private readonly container: Container) {
    registerScreens(this.screens);
    registerCommands(this.commands);
  }

  /** Dispatch a Telegram update. Routes to callback/message/channel handlers. */
  async dispatch(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    if (update.message) {
      await this.handleMessage(update.message);
      return;
    }
  }

  /** Handle a callback query — route to navigation or screen handler. */
  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const { container } = this;
    const tg = container.tg;

    const data = query.data ?? "";
    const fromId = query.from?.id;
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;

    if (!fromId || !chatId || !messageId) {
      await tg.answerCallbackQuery(query.id, "Error: missing context").catch(() => {});
      return;
    }

    // Authorization check.
    if (!this.isAdmin(fromId)) {
      await tg.answerCallbackQuery(query.id, "⛔ Unauthorized").catch(() => {});
      return;
    }

    // No-op button.
    if (data === "ignore") {
      await tg.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    // ── Special toggles (handled inline) ──────────────────────
    if (data === "toggle:approve") {
      await this.handleToggleApprove(query, fromId, chatId, messageId);
      return;
    }
    if (data === "toggle:botEnabled") {
      await this.handleToggleBot(query, fromId, chatId, messageId);
      return;
    }

    // ── Navigation: "menu:<id>" or "back" ────────────────────
    if (data === "back" || data === "menu:main" || data === "menu:back") {
      await this.navigate(query, "main", fromId, chatId, messageId);
      return;
    }
    if (data.startsWith("menu:")) {
      const targetId = data.slice(5);
      await this.navigate(query, targetId || "main", fromId, chatId, messageId);
      return;
    }

    // ── Delegate to screen: "set:", "action:", "<screenId>:..." ─
    const settings = await container.config.getSettings(fromId);
    const screenId = this.resolveScreenId(data);
    const screen = this.screens.get(screenId);
    if (!screen) {
      await tg.answerCallbackQuery(query.id, `❌ Unknown: ${screenId}`).catch(() => {});
      return;
    }

    const ctx: ScreenContext = {
      container,
      adminId: fromId,
      chatId,
      messageId,
      settings,
      query,
    };

    try {
      let action: ScreenAction | void;
      if (screen.onCallback) {
        action = await screen.onCallback(data, ctx);
      }

      if (action && typeof action === "object") {
        // Toast / alert.
        if (action.alert) {
          await tg.answerCallbackQuery(query.id, action.alert, true).catch(() => {});
        } else if (action.toast) {
          await tg.answerCallbackQuery(query.id, action.toast).catch(() => {});
        } else {
          await tg.answerCallbackQuery(query.id).catch(() => {});
        }

        // Redirect?
        if (action.redirectTo) {
          const targetId = this.resolveScreenId(action.redirectTo);
          const targetScreen = this.screens.get(targetId);
          if (targetScreen) {
            const newText = action.newText ?? await targetScreen.text(ctx);
            const newKeyboard = action.newKeyboard ?? targetScreen.keyboard(settings);
            await this.render(chatId, messageId, newText, newKeyboard);
          }
          return;
        }

        // Stay on same screen — render with new text/keyboard if provided,
        // otherwise re-render the current screen (to reflect any setting changes).
        const updatedSettings = await container.config.getSettings(fromId);
        const newText = action.newText ?? await screen.text({ ...ctx, settings: updatedSettings });
        const newKeyboard = action.newKeyboard ?? screen.keyboard(updatedSettings);
        await this.render(chatId, messageId, newText, newKeyboard);
      } else {
        // No action returned — close the callback query and re-render the screen.
        await tg.answerCallbackQuery(query.id, "🔄 Refreshed").catch(() => {});
        const updatedSettings = await container.config.getSettings(fromId);
        const newText = await screen.text({ ...ctx, settings: updatedSettings });
        const newKeyboard = screen.keyboard(updatedSettings);
        await this.render(chatId, messageId, newText, newKeyboard);
      }
    } catch (error) {
      console.error("[admin] callback handler error:", error);
      const message = error instanceof Error ? error.message : String(error);
      await tg.answerCallbackQuery(query.id, `❌ Error: ${message.slice(0, 200)}`, true).catch(() => {});
    }
  }

  /** Navigate to a screen — render it fresh. */
  private async navigate(
    query: TelegramCallbackQuery,
    screenId: string,
    fromId: number,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const { container } = this;
    const screen = this.screens.get(screenId);
    if (!screen) {
      await container.tg.answerCallbackQuery(query.id, `❌ Screen not found: ${screenId}`).catch(() => {});
      return;
    }

    const settings = await container.config.getSettings(fromId);
    const ctx: ScreenContext = {
      container,
      adminId: fromId,
      chatId,
      messageId,
      settings,
      query,
    };

    try {
      const text = await screen.text(ctx);
      const keyboard = screen.keyboard(settings);
      await container.tg.answerCallbackQuery(query.id).catch(() => {});
      await this.render(chatId, messageId, text, keyboard);
    } catch (error) {
      console.error("[admin] navigate error:", error);
      const message = error instanceof Error ? error.message : String(error);
      await container.tg.answerCallbackQuery(query.id, `❌ ${message.slice(0, 200)}`, true).catch(() => {});
    }
  }

  /** Render text + keyboard — edit message, or send new if edit fails. */
  private async render(
    chatId: number,
    messageId: number,
    text: string,
    keyboard: import("../types/telegram").InlineKeyboard,
  ): Promise<void> {
    const tg = this.container.tg;
    await tg.editMessageText(chatId, messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    }).catch(async (error: unknown) => {
      console.warn("[admin] editMessageText failed, sending new message:", error);
      await tg.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        disable_web_page_preview: true,
      }).catch(() => {});
    });
  }

  /** Handle toggle:approve inline. */
  private async handleToggleApprove(
    query: TelegramCallbackQuery,
    fromId: number,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const { container } = this;
    const tg = container.tg;
    const cur = await container.config.getSettings(fromId);
    const newVal = !cur.approveMode;
    await container.config.updateSettings(fromId, { approveMode: newVal });
    await tg.answerCallbackQuery(query.id, newVal ? "🔐 Approve ON" : "🔓 Approve OFF").catch(() => {});
    const updated = await container.config.getSettings(fromId);
    const ms = this.screens.get("main");
    if (ms) {
      const sctx: ScreenContext = { container, adminId: fromId, chatId, messageId, settings: updated, query };
      const newText = await ms.text(sctx);
      const newKb = ms.keyboard(updated);
      await this.render(chatId, messageId, newText, newKb);
    }
  }

  /** Handle toggle:botEnabled inline. */
  private async handleToggleBot(
    query: TelegramCallbackQuery,
    fromId: number,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const { container } = this;
    const tg = container.tg;
    const cur = await container.config.getSettings(fromId);
    const newVal = !cur.general.botEnabled;
    await container.config.updateSettings(fromId, { general: { ...cur.general, botEnabled: newVal } });
    await tg.answerCallbackQuery(query.id, newVal ? "🟢 Bot ON" : "🔴 Bot OFF").catch(() => {});
    const updated = await container.config.getSettings(fromId);
    const ms = this.screens.get("main");
    if (ms) {
      const sctx: ScreenContext = { container, adminId: fromId, chatId, messageId, settings: updated, query };
      const newText = await ms.text(sctx);
      const newKb = ms.keyboard(updated);
      await this.render(chatId, messageId, newText, newKb);
    }
  }

  /** Handle a private message — route to command registry. */
  private async handleMessage(message: TelegramMessage): Promise<void> {
    const { container } = this;
    const tg = container.tg;

    const fromId = message.from?.id;
    const chatId = message.chat?.id;
    const text = message.text ?? "";

    if (!fromId || !chatId) return;

    // Authorization check.
    if (!this.isAdmin(fromId)) {
      await tg.sendMessage(chatId, unauthorizedMessage(fromId), {
        parse_mode: "HTML",
      }).catch(() => {});
      return;
    }

    // If not a command, ignore (admin panel is keyboard-driven).
    if (!text.startsWith("/")) {
      return;
    }

    // Typing indicator.
    await tg.sendChatAction(chatId, "typing").catch(() => {});

    // Match command.
    const match = this.commands.match(text);
    if (!match) {
      await tg.sendMessage(
        chatId,
        `❓ Unknown command: <code>${escapeHtml(text)}</code>\n\nUse /help to see available commands.`,
        { parse_mode: "HTML" },
      ).catch(() => {});
      return;
    }

    const ctx: CommandContext = {
      container,
      adminId: fromId,
      chatId,
      args: match.args,
      reply: async (replyText: string) => {
        await tg.sendMessage(chatId, replyText, { parse_mode: "HTML" }).catch(() => {});
      },
    };

    try {
      await match.command.handle(ctx);
    } catch (error) {
      console.error("[admin] command handler error:", error);
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ Command failed: <code>${escapeHtml(message)}</code>`).catch(() => {});
    }
  }

  /** Check if a user is the admin. */
  private isAdmin(userId: number): boolean {
    const adminId = this.container.env.ADMIN_ID;
    if (!adminId) return false;
    return String(userId) === adminId;
  }

  /**
   * Resolve a callback data string to a screen ID.
   *   "set:ai:temp:0.5" → "ai"
   *   "action:manual:A" → "manual"
   *   "soul:view"       → "soul"
   *   "scheduler:refresh" → "schedule"
   */
  private resolveScreenId(data: string): string {
    const parts = data.split(":");
    const first = parts[0] ?? "";
    const second = parts[1] ?? "";

    // "set:<scope>:..." → scope maps to screen ID
    if (first === "set") {
      if (second === "scheduler") return "schedule";
      if (second === "providers") return "providers";
      if (second === "plugins") return "providers"; // plugin toggles live on providers screen
      return second || "main";
    }

    // "action:<scope>:..." → scope maps to screen ID
    if (first === "action") {
      if (second === "scheduler") return "schedule";
      if (second === "manual") return "manual";
      if (second === "soul") return "soul";
      if (second === "debug") return "debug";
      if (second === "test") return "providers"; // test actions live on providers screen
      if (second === "stats") return "stats";
      if (second === "plugins") return "providers";
      if (second === "providers") return "providers";
      return second || "main";
    }

    // "toggle:<scope>" → main screen handles toggles inline
    if (first === "toggle") return "main";

    // Direct screen IDs: "soul:view", "scheduler:refresh", etc.
    if (first === "scheduler") return "schedule";
    if (first === "soul") return "soul";
    if (first === "manual") return "manual";

    return first || "main";
  }
}

/** Escape HTML special characters. */
function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

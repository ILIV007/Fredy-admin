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
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../types/telegram";
import { ScreenRegistry, CommandRegistry } from "../admin/registry";
import type { CommandContext, ScreenAction, ScreenContext } from "../admin/registry";
import { escapeHtml } from "../primitives/strings";
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
      let action: ScreenAction | void = undefined;
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
            const newKeyboard = action.newKeyboard ?? targetScreen.keyboard(settings, ctx);
            await this.render(chatId, messageId, newText, newKeyboard);
          }
          return;
        }

        // Stay on same screen — render with new text/keyboard if provided,
        // otherwise re-render the current screen (to reflect any setting changes).
        const updatedSettings = await container.config.getSettings(fromId);
        const newText = action.newText ?? await screen.text({ ...ctx, settings: updatedSettings });
        const newKeyboard = action.newKeyboard ?? screen.keyboard(updatedSettings, ctx);
        await this.render(chatId, messageId, newText, newKeyboard);
      } else {
        // No action returned — close the callback query and re-render the screen.
        await tg.answerCallbackQuery(query.id, "🔄 Refreshed").catch(() => {});
        const updatedSettings = await container.config.getSettings(fromId);
        const newText = await screen.text({ ...ctx, settings: updatedSettings });
        const newKeyboard = screen.keyboard(updatedSettings, ctx);
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
      const keyboard = screen.keyboard(settings, ctx);
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
      const newKb = ms.keyboard(updated, sctx);
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
      const newKb = ms.keyboard(updated, sctx);
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


    if (!fromId || !chatId) {
      return;
    }

    // Authorization check.
    if (!this.isAdmin(fromId)) {
      await tg.sendMessage(chatId, unauthorizedMessage(fromId), {
        parse_mode: "HTML",
      }).catch(() => {});
      return;
    }


    // Typing indicator — send for ALL messages (commands and non-commands).
    await tg.sendChatAction(chatId, "typing").catch(() => {});

    try {
      // If not a command, respond with a helpful message.
      if (!text.startsWith("/")) {
        await tg.sendMessage(chatId, [
          "👋 <b>Fredy Admin Bot</b>",
          "",
          "I received your message. Use these commands:",
          "",
          "<code>/menu</code> — Open admin dashboard",
          "<code>/start</code> — Open admin panel",
          "<code>/help</code> — Show help",
          "<code>/stats</code> — Show statistics",
          "<code>/health</code> — Health check",
        ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        return;
      }

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

      await match.command.handle(ctx);
    } catch (error) {
      console.error("[admin] command handler error:", error);
      const errMsg = error instanceof Error ? error.message : String(error);

      // Send error to user so they can see what went wrong.
      await tg.sendMessage(chatId, [
        "❌ <b>Error occurred</b>",
        "",
        `<code>${escapeHtml(errMsg)}</code>`,
        "",
        "<i>Check Manager → Logs for details.</i>",
      ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
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

    // "menu:<id>" → navigate to screen <id>
    if (first === "menu") return second || "main";

    // "set:<scope>:..." → scope maps to screen ID
    if (first === "set") {
      if (second === "scheduler") return "schedule";
      if (second === "strategy") return "strategy";
      if (second === "language") return "language";
      if (second === "providers") return "providers";
      if (second === "plugins") return "providers";
      if (second === "general" || second === "language" || second === "content" || second === "quality" || second === "debug") return "settings";
      if (second === "ai") return "ai";
      if (second === "categories") return "categories";
      if (second === "editor") return "editor";
      return second || "main";
    }

    // "action:<scope>:..." → scope maps to screen ID
    if (first === "action") {
      if (second === "scheduler") return "schedule";
      if (second === "manual") return "manual";
      if (second === "soul") return "soul";
      if (second === "debug") return "debug";
      if (second === "test") return "providers";
      if (second === "stats") return "stats";
      if (second === "plugins") return "providers";
      if (second === "providers") return "providers";
      if (second === "main") return "main";
      return second || "main";
    }

    // "toggle:<scope>" → main screen handles toggles inline
    if (first === "toggle") return "main";

    // Direct screen IDs
    if (first === "scheduler") return "schedule";
    if (first === "soul") return "soul";
    if (first === "manual") return "manual";

    return first || "main";
  }
}

// escapeHtml is imported from primitives/strings.ts — single source of truth.

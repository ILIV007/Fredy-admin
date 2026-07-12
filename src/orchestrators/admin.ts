/**
 * src/orchestrators/admin.ts
 * Admin panel orchestrator. Routes Telegram updates to the screen/command
 * registries. Replaces AI Admin's handleUpdate + handleCallbackQuery +
 * handlePrivateMessage (3 functions, ~500 lines) with a thin dispatcher.
 *
 * See ARCHITECTURE_RULES.md §12.
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
    // Channel posts and edits are not handled by the admin panel.
  }

  /** Handle a callback query — look up screen, call onCallback, render result. */
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

    // Special: ignore no-op buttons.
    if (data === "ignore") {
      await tg.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    // Special: toggle:approve
    if (data === "toggle:approve") {
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
        await tg.editMessageText(chatId, messageId, newText, { parse_mode: "HTML", reply_markup: newKb, disable_web_page_preview: true }).catch(() => {});
      }
      return;
    }

    // Special: toggle:botEnabled
    if (data === "toggle:botEnabled") {
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
        await tg.editMessageText(chatId, messageId, newText, { parse_mode: "HTML", reply_markup: newKb, disable_web_page_preview: true }).catch(() => {});
      }
      return;
    }

    // Parse the callback data: "menu:<id>" or "set:<scope>:<value>" or "action:<name>:<args>".
    const screenId = this.resolveScreenId(data);
    const screen = this.screens.get(screenId);
    if (!screen) {
      await tg.answerCallbackQuery(query.id, `❌ Unknown screen: ${screenId}`).catch(() => {});
      return;
    }

    // Load settings.
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
      let action: ScreenAction | void;
      if (screen.onCallback) {
        action = await screen.onCallback(data, ctx);
      } else {
        action = undefined;
      }

      // If the screen returned an action, apply it.
      if (action && typeof action === "object") {
        // Toast / alert first (closes the loading spinner).
        if (action.alert) {
          await tg.answerCallbackQuery(query.id, action.alert, true).catch(() => {});
        } else if (action.toast) {
          await tg.answerCallbackQuery(query.id, action.toast).catch(() => {});
        } else {
          await tg.answerCallbackQuery(query.id).catch(() => {});
        }

        // Redirect to another screen?
        const targetScreenId = action.redirectTo
          ? this.resolveScreenId(action.redirectTo)
          : screen.id;
        const targetScreen = this.screens.get(targetScreenId) ?? screen;

        // Compute the new text and keyboard.
        // If the action provided explicit text/keyboard, use those.
        // Otherwise, re-render the target screen.
        const newText = action.newText ?? await targetScreen.text(ctx);
        const newKeyboard = action.newKeyboard ?? targetScreen.keyboard(settings);

        await tg.editMessageText(chatId, messageId, newText, {
          parse_mode: "HTML",
          reply_markup: newKeyboard,
          disable_web_page_preview: true,
        }).catch(async (error: unknown) => {
          // If editing fails (e.g., message too old), send a new message.
          console.warn("[admin] editMessageText failed, sending new message:", error);
          await tg.sendMessage(chatId, newText, {
            parse_mode: "HTML",
            reply_markup: newKeyboard,
            disable_web_page_preview: true,
          }).catch(() => {});
        });
      } else {
        // No action returned — this is a NAVIGATION click (e.g., "menu:schedule").
        // Re-render the target screen with its text and keyboard.
        await tg.answerCallbackQuery(query.id).catch(() => {});

        const newText = await screen.text(ctx);
        const newKeyboard = screen.keyboard(settings);

        await tg.editMessageText(chatId, messageId, newText, {
          parse_mode: "HTML",
          reply_markup: newKeyboard,
          disable_web_page_preview: true,
        }).catch(async (error: unknown) => {
          console.warn("[admin] editMessageText failed (nav), sending new message:", error);
          await tg.sendMessage(chatId, newText, {
            parse_mode: "HTML",
            reply_markup: newKeyboard,
            disable_web_page_preview: true,
          }).catch(() => {});
        });
      }
    } catch (error) {
      console.error("[admin] callback handler error:", error);
      const message = error instanceof Error ? error.message : String(error);
      await tg.answerCallbackQuery(query.id, `❌ Error: ${message.slice(0, 200)}`, true).catch(() => {});
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
   * Examples:
   *   "menu:main"       → "main"
   *   "menu:schedule"   → "schedule"
   *   "set:ai:temp:0.5" → "ai"  (settings handled by the screen itself)
   *   "action:manual:A" → "manual"
   *   "soul:view"       → "soul"
   */
  private resolveScreenId(data: string): string {
    const parts = data.split(":");
    const first = parts[0] ?? "";
    const second = parts[1] ?? "";

    if (first === "menu") return second || "main";
    if (first === "set") return second || "main";
    if (first === "action") return second || "main";
    // toggle:* is handled above, never reaches here
    if (first === "toggle") return "main";
    // manual:* → manual screen
    if (first === "manual") return "manual";
    return first || "main";
  }
}

/** Escape HTML special characters. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * src/admin/registry.ts
 * Screen and Command registries. Replaces AI Admin's 265-line if/else cascade
 * with a clean plugin-style registration. See ARCHITECTURE_RULES.md §12.1, §21.2.
 */

import type { FredySettings } from "../types/config";
import type { Container } from "../types/env";
import type { InlineKeyboard, TelegramCallbackQuery } from "../types/telegram";

// ────────────────────────────────────────────────────────────
// Screens
// ────────────────────────────────────────────────────────────

export interface ScreenContext {
  readonly container: Container;
  readonly adminId: number;
  readonly chatId: number;
  readonly messageId: number;
  readonly settings: FredySettings;
  readonly query: TelegramCallbackQuery;
}

export interface ScreenAction {
  /** New text to display (re-renders the message). */
  readonly newText?: string;
  /** New keyboard to display (re-renders the message). */
  readonly newKeyboard?: InlineKeyboard;
  /** Toast notification (via answerCallbackQuery). */
  readonly toast?: string;
  /** Show an alert (popup) instead of a toast. */
  readonly alert?: string;
  /** Redirect to another screen after handling. */
  readonly redirectTo?: string;
}

export interface Screen {
  readonly id: string;
  text(ctx: ScreenContext): Promise<string> | string;
  keyboard(settings: FredySettings, ctx?: ScreenContext): InlineKeyboard;
  /**
   * Handle a callback for this screen. The callback data is the full string.
   * Returns a ScreenAction describing what to update.
   * If null/undefined, just re-renders the screen.
   */
  onCallback?(data: string, ctx: ScreenContext): Promise<ScreenAction | void>;
}

export class ScreenRegistry {
  private readonly screens = new Map<string, Screen>();

  register(screen: Screen): void {
    if (this.screens.has(screen.id)) {
      throw new Error(`Screen "${screen.id}" already registered`);
    }
    this.screens.set(screen.id, screen);
  }

  get(id: string): Screen | null {
    return this.screens.get(id) ?? null;
  }

  list(): readonly Screen[] {
    return Array.from(this.screens.values());
  }
}

// ────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────

export interface CommandContext {
  readonly container: Container;
  readonly adminId: number;
  readonly chatId: number;
  readonly args: string;
  /** Send a reply with HTML parse mode. */
  reply(text: string): Promise<void>;
}

export interface Command {
  readonly name: string; // "/start", "/help"
  readonly description: string;
  handle(ctx: CommandContext): Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command "${command.name}" already registered`);
    }
    this.commands.set(command.name, command);
  }

  get(name: string): Command | null {
    return this.commands.get(name) ?? null;
  }

  list(): readonly Command[] {
    return Array.from(this.commands.values());
  }

  /** Find a command by matching the start of input text. Returns args. */
  match(input: string): { command: Command; args: string } | null {
    for (const command of this.commands.values()) {
      const re = new RegExp(`^${command.name}\\b`, "i");
      if (re.test(input)) {
        const args = input.replace(re, "").trim();
        return { command, args };
      }
    }
    return null;
  }
}

/**
 * src/services/formatter.ts
 * Formatter service. Wraps formatter plugins and applies soul-driven rules.
 * See FREDY_GUIDELINES.md §3 (HTML rules), §4 (emoji rules), §5 (source footer).
 */

import type { Formatter } from "../types/plugin";
import type { Post } from "../types/post";

export interface FormatInput {
  readonly text: string;
  readonly category: import("../types/category").Category;
  readonly sourceUrl: string | null;
  readonly sourceEmoji: string;
  readonly footer: string;
  readonly language: string;
}

export interface FormatResult {
  readonly text: string;
  readonly parseMode: "HTML" | "MarkdownV2" | null;
}

export interface FormatterServiceDeps {
  readonly formatters: readonly Formatter[];
  readonly defaultName: string;
}

export class FormatterService {
  private readonly registry = new Map<string, Formatter>();

  constructor(deps: FormatterServiceDeps) {
    for (const formatter of deps.formatters) {
      this.registry.set(formatter.name, formatter);
    }
  }

  /** Format an AI-generated text into a Telegram-ready post. */
  format(input: FormatInput, formatterName?: string): FormatResult {
    const name = formatterName ?? this.deps.defaultName;
    const formatter = this.registry.get(name);
    if (!formatter) {
      throw new Error(`Formatter "${name}" not registered`);
    }
    return formatter.format(input);
  }

  /** Validate that HTML tags are balanced (rough check). */
  validate(html: string): boolean {
    // TODO: port from AI Admin src/formatter.js in Phase 6.
    void html;
    return true;
  }
}

/** Re-export FormatInput/FormatResult for plugin.ts import path. */
export type { FormatInput, FormatResult };

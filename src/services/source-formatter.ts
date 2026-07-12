/**
 * src/services/source-formatter.ts
 * Builds the "[emoji]Source" footer line and rotates emojis naturally.
 *
 * See FREDY_GUIDELINES.md §5 (Source Format).
 *
 * The emoji rotation tracks the last N emojis used and picks the one
 * whose last use is oldest. Never repeats the same emoji twice in a row.
 */

import { SOURCE_EMOJI_POOL } from "../core/constants";
import type { FredyState } from "../types/config";
import type { Logger } from "./logger";

export interface SourceFormatterDeps {
  readonly logger: Logger;
  readonly state: () => Promise<FredyState>;
}

/** Default history size. */
const DEFAULT_HISTORY_SIZE = 10;

export class SourceFormatter {
  constructor(private readonly deps: SourceFormatterDeps) {}

  /** Pick the next emoji for the source footer. */
  async nextEmoji(): Promise<string> {
    const state = await this.deps.state();
    const history = state.lastSourceEmojis;

    // For each emoji in the pool, find when it was last used.
    // Pick the one with the oldest (or no) last use.
    let bestEmoji = SOURCE_EMOJI_POOL[0]!;
    let bestLastUse = Infinity;

    for (const emoji of SOURCE_EMOJI_POOL) {
      const lastUseIndex = history.lastIndexOf(emoji);
      // lastUseIndex of -1 means "never used" → treat as -Infinity (oldest).
      const effective = lastUseIndex === -1 ? -1 : lastUseIndex;
      if (effective < bestLastUse) {
        bestLastUse = effective;
        bestEmoji = emoji;
      }
    }

    // Avoid same emoji twice in a row.
    if (history.length > 0 && bestEmoji === history[history.length - 1]) {
      // Pick the second-oldest.
      for (const emoji of SOURCE_EMOJI_POOL) {
        if (emoji === bestEmoji) continue;
        const lastUseIndex = history.lastIndexOf(emoji);
        const effective = lastUseIndex === -1 ? -1 : lastUseIndex;
        if (effective < bestLastUse || bestEmoji === history[history.length - 1]) {
          bestEmoji = emoji;
          bestLastUse = effective;
          break;
        }
      }
    }

    return bestEmoji;
  }

  /** Build the source footer line: "[emoji]Source". */
  async buildFooter(): Promise<{ emoji: string; footer: string }> {
    const emoji = await this.nextEmoji();
    return { emoji, footer: `${emoji}Source` };
  }

  /** Build a footer with a specific emoji (for testing/manual). */
  buildFooterWithEmoji(emoji: string): string {
    return `${emoji}Source`;
  }

  /** Get the full emoji pool (for the admin panel). */
  getPool(): readonly string[] {
    return SOURCE_EMOJI_POOL;
  }

  /** Get the recent emoji history (for the admin panel). */
  async getHistory(): Promise<readonly string[]> {
    const state = await this.deps.state();
    return state.lastSourceEmojis;
  }
}

/** Re-export for testing. */
export { DEFAULT_HISTORY_SIZE };

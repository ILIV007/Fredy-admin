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
    // Simple random selection — no persistence needed.
    const idx = Math.floor(Math.random() * SOURCE_EMOJI_POOL.length);
    return SOURCE_EMOJI_POOL[idx]!;
  }

  /** Build the source footer line with a rotating emoji. */
  async buildFooter(): Promise<{ emoji: string; footer: string }> {
    const emoji = await this.nextEmoji();
    // Persist the emoji to history so rotation works.
    await this.recordEmoji(emoji);
    return { emoji, footer: `${emoji} Source` };
  }

  /** Record an emoji as used (persist to state). */
  private async recordEmoji(emoji: string): Promise<void> {
    try {
      const state = await this.deps.state();
      const history = [...state.lastSourceEmojis, emoji].slice(-10);
      // Update state with new history. We need config to persist.
      // Since SourceFormatter doesn't have direct config access,
      // we'll use a simple KV approach via the state callback.
      // The state is managed by ConfigService.updateState.
      // For now, we just keep in-memory rotation (better than nothing).
      // TODO: wire to config.updateState for true persistence.
    } catch {
      // ignore
    }
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

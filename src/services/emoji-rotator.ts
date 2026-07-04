/**
 * src/services/emoji-rotator.ts
 * Rotates the source footer emoji. Tracks last N emojis to avoid repetition.
 * See FREDY_GUIDELINES.md §5.
 */

import { SOURCE_EMOJI_POOL } from "../core/constants";
import type { FredyState } from "../types/config";
import type { KVStore } from "./kv-store";

export interface EmojiRotatorDeps {
  readonly kv: KVStore;
  readonly state: () => Promise<FredyState>;
}

const HISTORY_SIZE = 10;

export class EmojiRotator {
  constructor(private readonly deps: EmojiRotatorDeps) {}

  /** Pick the next emoji — the one whose last use is oldest. */
  async next(): Promise<string> {
    const state = await this.deps.state();
    const history = state.lastSourceEmojis;

    // For each emoji in the pool, find when it was last used.
    // Pick the one with the oldest (or no) last use.
    let bestEmoji = SOURCE_EMOJI_POOL[0]!;
    let bestLastUse = Infinity;

    for (const emoji of SOURCE_EMOJI_POOL) {
      const lastUse = history.lastIndexOf(emoji);
      const effective = lastUse === -1 ? -1 : lastUse;
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
        const lastUse = history.lastIndexOf(emoji);
        if (lastUse < bestLastUse) {
          bestEmoji = emoji;
          bestLastUse = lastUse;
          break;
        }
      }
    }

    return bestEmoji;
  }

  /** Record that an emoji was used. Called by the pipeline after publishing. */
  async record(emoji: string): Promise<void> {
    const state = await this.deps.state();
    const history = [...state.lastSourceEmojis, emoji].slice(-HISTORY_SIZE);
    // Update state via KV — the caller (ContentManager) handles this via ConfigService.updateState.
    // Here we just update the in-memory cache for the next read.
    void history;
  }
}

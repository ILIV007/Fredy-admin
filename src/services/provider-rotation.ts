/**
 * src/services/provider-rotation.ts
 * v11.1.0: Provider Rotation — prevents repetitive publishing.
 *
 * Rules (per spec):
 *   1. Avoid selecting the same provider in consecutive publish cycles.
 *   2. Avoid repeating the same provider until at least 2 other providers have published.
 *   3. Avoid publishing the same topic repeatedly.
 *
 * State is stored in KV at `fredy:rotation:history` (lightweight ring buffer).
 * This keeps KV writes minimal (1 write per publish, not per tick).
 */

import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

export interface ProviderRotationDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
}

/** Rotation history entry. */
export interface RotationEntry {
  readonly providerId: string;
  readonly publishedAt: number;
  readonly topicHash: string;
}

/** Rotation state stored in KV. */
export interface RotationState {
  readonly history: readonly RotationEntry[];
  readonly lastProvider: string | null;
  readonly recentTopics: readonly string[]; // last N topic hashes
}

const ROTATION_KEY = "fredy:rotation:history";
const ROTATION_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const MAX_HISTORY = 20;
const MIN_PROVIDERS_BETWEEN_REPEAT = 2;
const MAX_RECENT_TOPICS = 10;

export class ProviderRotation {
  constructor(private readonly deps: ProviderRotationDeps) {}

  /**
   * Load the current rotation state from KV.
   * Returns a default empty state if none exists.
   */
  async load(): Promise<RotationState> {
    const state = await this.deps.kv.getJson<RotationState>(ROTATION_KEY).catch(() => null);
    if (state) return state;
    return { history: [], lastProvider: null, recentTopics: [] };
  }

  /**
   * Filter out providers that are not eligible based on rotation rules.
   * Returns the list of eligible provider IDs.
   *
   * Rules:
   *   1. Exclude the last provider (no consecutive repeats).
   *   2. Exclude providers that published within the last MIN_PROVIDERS_BETWEEN_REPEAT cycles.
   */
  getEligible(
    candidateIds: readonly string[],
    state: RotationState,
  ): readonly string[] {
    if (candidateIds.length === 0) return [];

    // Rule 1: Exclude last provider
    const lastProvider = state.lastProvider;
    let eligible = candidateIds.filter((id) => id !== lastProvider);

    // If excluding the last provider leaves nothing, allow it (better than no content)
    if (eligible.length === 0) {
      eligible = [...candidateIds];
    }

    // Rule 2: Exclude providers in the recent history (last MIN_PROVIDERS_BETWEEN_REPEAT entries)
    const recentProviders = state.history
      .slice(0, MIN_PROVIDERS_BETWEEN_REPEAT)
      .map((e) => e.providerId);

    let filtered = eligible.filter((id) => !recentProviders.includes(id));

    // If filtering leaves nothing, use the eligible list (relax rule 2)
    if (filtered.length === 0) {
      filtered = eligible;
    }

    return filtered;
  }

  /**
   * Check if a topic (content hash) was recently published.
   * Returns true if the topic is a repeat within the recent window.
   */
  isTopicRepeat(topicHash: string, state: RotationState): boolean {
    return state.recentTopics.includes(topicHash);
  }

  /**
   * Record a publish event in the rotation history.
   * Updates the state in KV (fire-and-forget).
   */
  async recordPublish(providerId: string, topicHash: string): Promise<void> {
    const state = await this.load();
    const entry: RotationEntry = {
      providerId,
      publishedAt: Date.now(),
      topicHash,
    };

    const newState: RotationState = {
      history: [entry, ...state.history].slice(0, MAX_HISTORY),
      lastProvider: providerId,
      recentTopics: [topicHash, ...state.recentTopics].slice(0, MAX_RECENT_TOPICS),
    };

    await this.deps.kv.setJson(ROTATION_KEY, newState, ROTATION_TTL_SECONDS).catch(() => {});
  }

  /**
   * Get a summary of the rotation state for the dashboard.
   */
  async getSummary(): Promise<{
    readonly lastProvider: string | null;
    readonly recentProviders: readonly string[];
    readonly totalPublished: number;
    readonly uniqueProviders: number;
  }> {
    const state = await this.load();
    const recentProviders = state.history.slice(0, 5).map((e) => e.providerId);
    const uniqueProviders = new Set(state.history.map((e) => e.providerId)).size;

    return {
      lastProvider: state.lastProvider,
      recentProviders,
      totalPublished: state.history.length,
      uniqueProviders,
    };
  }
}

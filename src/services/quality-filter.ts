/**
 * src/services/quality-filter.ts
 * Scores generated posts 0..100. Rejects posts below min_score.
 * Composes individual QualityCheck plugins. See FREDY_GUIDELINES.md §9.
 *
 * Now consumes the section-based QualityConfig.
 */

import type { Post } from "../types/post";
import type { QualityResult } from "../types/quality";
import type { QualityCheck } from "../types/plugin";
import type { FredySettings } from "../types/config";
import type { QualityConfig } from "../core/config/sections/quality";
import type { KVStore } from "./kv-store";

export interface QualityFilterDeps {
  readonly kv: KVStore;
  readonly checks: readonly QualityCheck[];
  readonly settings: () => Promise<FredySettings>;
}

export class QualityFilter {
  constructor(private readonly deps: QualityFilterDeps) {}

  /** Get the quality config section. */
  private async getConfig(): Promise<QualityConfig> {
    const settings = await this.deps.settings();
    return settings.quality;
  }

  /** Run all quality checks against a post. Returns the overall result. */
  async evaluate(post: Post): Promise<QualityResult> {
    const config = await this.getConfig();

    // Hard rejects — checked first, short-circuit.
    if (config.rejectEmptyOutput && post.text.trim().length === 0) {
      return {
        passed: false,
        score: 0,
        checks: [],
        hardReject: true,
        hardRejectReason: "Empty output",
      };
    }
    if (post.text.length < config.minLength) {
      return {
        passed: false,
        score: 0,
        checks: [],
        hardReject: true,
        hardRejectReason: `Below minimum length (${post.text.length} < ${config.minLength})`,
      };
    }
    if (post.text.length > config.maxLength) {
      return {
        passed: false,
        score: 0,
        checks: [],
        hardReject: true,
        hardRejectReason: `Exceeds maximum length (${post.text.length} > ${config.maxLength})`,
      };
    }

    // TODO: implement composable checks in Phase 4.
    void post;
    return {
      passed: false,
      score: 0,
      checks: [],
      hardReject: true,
      hardRejectReason: "QualityFilter not implemented (Phase 4)",
    };
  }

  /** Record a dedup hash for a published post. */
  async recordDedup(post: Post): Promise<void> {
    const config = await this.getConfig();
    if (!config.duplicateDetection) return;
    // TODO: hash first 200 chars normalized, store with TTL.
    void post;
  }

  /** Check if a post's hash is already in the dedup store. */
  async isDuplicate(post: Post): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.duplicateDetection) return false;
    // TODO: implement in Phase 4.
    void post;
    return false;
  }
}

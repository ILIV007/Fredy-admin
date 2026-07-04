/**
 * src/services/category-manager.ts
 * Tracks daily quotas, decides next category, enforces anti-repeat.
 * See FREDY_GUIDELINES.md §1 (Category rotation rule).
 *
 * Now consumes the section-based CategoriesConfig.
 */

import type { Category } from "../types/category";
import type { CategoriesConfig, CategoryItemConfig } from "../core/config/sections/categories";
import type { FredyState } from "../types/config";
import type { KVStore } from "./kv-store";

export interface CategoryManagerDeps {
  readonly kv: KVStore;
  readonly config: () => Promise<CategoriesConfig>;
  readonly state: () => Promise<FredyState>;
}

export class CategoryManager {
  constructor(private readonly deps: CategoryManagerDeps) {}

  /** Pick the next category to publish, given today's progress and last category. */
  async nextCategory(lastCategory: Category | null): Promise<Category | null> {
    const config = await this.deps.config();
    const state = await this.deps.state();

    // Filter enabled categories that haven't met their quota.
    const candidates: Array<{ category: Category; weight: number; priority: number }> = [];
    for (const cat of ["A", "B", "C"] as const) {
      const item = config[cat];
      if (!item.enabled) continue;
      const published = state.today.categoriesPublished[cat] ?? 0;
      if (published >= item.dailyLimit) continue;
      // Anti-repeat: avoid same category twice in a row (unless allowed).
      if (cat === lastCategory && !config.allowSameCategoryTwice) {
        // Only skip if there are other candidates.
        continue;
      }
      candidates.push({ category: cat, weight: item.weight, priority: item.priority });
    }

    if (candidates.length === 0) return null;

    // Sort by priority (1 = highest), then pick by weight.
    candidates.sort((a, b) => a.priority - b.priority);

    // If only one candidate, return it.
    if (candidates.length === 1) return candidates[0]!.category;

    // Weighted pick among the top-priority candidates.
    const topPriority = candidates[0]!.priority;
    const topCandidates = candidates.filter((c) => c.priority === topPriority);
    const weights = topCandidates.map((c) => c.weight);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) return topCandidates[0]!.category;

    let random = Math.random() * totalWeight;
    for (const candidate of topCandidates) {
      random -= candidate.weight;
      if (random <= 0) return candidate.category;
    }
    return topCandidates[topCandidates.length - 1]!.category;
  }

  /** Get today's published counts per category. */
  async todayCounts(): Promise<Readonly<Record<Category, number>>> {
    const state = await this.deps.state();
    return state.today.categoriesPublished;
  }

  /** Check if a category has met its daily quota. */
  async isQuotaMet(category: Category): Promise<boolean> {
    const config = await this.deps.config();
    const counts = await this.todayCounts();
    const quota = config[category]?.dailyLimit ?? 0;
    return (counts[category] ?? 0) >= quota;
  }

  /** Get the config for a single category. */
  async getConfig(category: Category): Promise<CategoryItemConfig | null> {
    const config = await this.deps.config();
    return config[category] ?? null;
  }

  /** Check if a category is enabled. */
  async isEnabled(category: Category): Promise<boolean> {
    const config = await this.deps.config();
    return config[category]?.enabled ?? false;
  }

  /** Get the fallback rule for a category. */
  async getFallbackRule(category: Category): Promise<"skip" | "next" | "retry"> {
    const config = await this.deps.config();
    return config[category]?.fallback ?? "skip";
  }

  /** Record that a category was published (called by the pipeline after success). */
  async recordPublish(category: Category): Promise<void> {
    // TODO: implement in Phase 4 (Scheduler) — increment state via ConfigService.updateState.
    void category;
  }
}

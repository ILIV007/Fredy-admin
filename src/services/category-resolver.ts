/**
 * src/services/category-resolver.ts
 * Detects or confirms the category for a content item.
 *
 * Each plugin declares a category in its manifest. The resolver:
 *   1. Trusts the plugin's category by default.
 *   2. Cross-checks the content against category keywords.
 *   3. Returns the resolved category + confidence.
 *
 * See FREDY_GUIDELINES.md §1 (Categories).
 */

import type { Category } from "../types/category";
import type { ContentItem } from "../types/content";
import type { PluginManager } from "./plugin-manager";
import type { Logger } from "./logger";

export interface CategoryResolverDeps {
  readonly logger: Logger;
  readonly pluginManager: PluginManager;
}

export interface CategoryResolveResult {
  readonly category: Category;
  readonly confidence: number; // 0-100
  readonly detectedFromContent: boolean;
  readonly mismatch: boolean;
}

/** Keywords per category (for content-based detection). */
const CATEGORY_KEYWORDS: Readonly<Record<Category, readonly string[]>> = {
  A: [
    "programming", "code", "github", "open source", "framework", "library",
    "api", "sdk", "developer tool", "javascript", "python", "rust", "golang",
    "typescript", "react", "vue", "angular", "node", "deno", "bun",
    "ai", "ml", "machine learning", "neural", "llm", "model", "gpt",
    "tutorial", "guide", "how to", "dev tip", "best practice",
  ],
  B: [
    "news", "announces", "released", "launches", "breaking", "update",
    "acquisition", "merger", "funding", "ipo", "startup", "tech news",
  ],
  C: [
    "nasa", "astronomy", "space", "galaxy", "planet", "star", "telescope",
    "joke", "funny", "humor", "quote", "fact", "trivia", "did you know",
  ],
};

export class CategoryResolver {
  constructor(private readonly deps: CategoryResolverDeps) {}

  /** Resolve the category for a content item. */
  resolve(item: ContentItem): CategoryResolveResult {
    const pluginCategory = this.getPluginCategory(item.pluginId);

    // If no plugin category, detect from content.
    if (!pluginCategory) {
      const detected = this.detectFromContent(item);
      return {
        category: detected.category,
        confidence: detected.confidence,
        detectedFromContent: true,
        mismatch: false,
      };
    }

    // Cross-check: does the content match the plugin's category?
    const contentCheck = this.detectFromContent(item);
    const mismatch = contentCheck.category !== pluginCategory && contentCheck.confidence > 60;

    if (mismatch) {
      this.deps.logger.warn("quality.reject", {
        contentId: item.id,
        pluginId: item.pluginId,
        pluginCategory,
        detectedCategory: contentCheck.category,
        confidence: contentCheck.confidence,
        message: "Category mismatch between plugin and content",
      });
    }

    return {
      category: pluginCategory,
      confidence: mismatch ? 50 : Math.max(80, contentCheck.confidence),
      detectedFromContent: false,
      mismatch,
    };
  }

  /** Get the category declared by the plugin. */
  private getPluginCategory(pluginId: string): Category | null {
    const plugin = this.deps.pluginManager.get(pluginId);
    return plugin?.getCategory() ?? null;
  }

  /** Detect category from content text. */
  private detectFromContent(item: ContentItem): { category: Category; confidence: number } {
    const text = `${item.title} ${item.body}`.toLowerCase();
    const scores: Record<Category, number> = { A: 0, B: 0, C: 0 };

    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          scores[cat as Category] += 1;
        }
      }
    }

    const max = Math.max(scores.A, scores.B, scores.C);
    if (max === 0) {
      // No keywords matched — default to A (most common).
      return { category: "A", confidence: 30 };
    }

    const category = (Object.entries(scores).find(([, v]) => v === max)?.[0] ?? "A") as Category;
    const confidence = Math.min(100, 40 + max * 15);

    return { category, confidence };
  }
}

/** Re-export keyword map for testing. */
export { CATEGORY_KEYWORDS };

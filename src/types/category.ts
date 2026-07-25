/**
 * src/types/category.ts
 * Content category system. See FREDY_GUIDELINES.md §1.
 *
 * v13.0.0: Added Category "H" (Hardware & Technology Headlines).
 * Category H is a REAL Strategy Category (not an overlay, not a replacement
 * for A/B/C). It is ADDITIVE — increases the number of daily Strategy posts
 * depending on the selected Strategy Mode. See strategy.ts extraHPosts.
 */

/** The content categories. v13.0.0: added "H". */
export type Category = "A" | "B" | "C" | "H";

/** Per-category runtime configuration. */
export interface CategoryConfig {
  readonly enabled: boolean;
  readonly quota: number;
  readonly weight: number;
}

/** Per-category runtime state (changes often). */
export interface CategoryState {
  readonly category: Category;
  readonly publishedToday: number;
  readonly lastPublishedAt: number | null;
}

/** Category A: programming, AI, GitHub, dev tools. 2 posts/day. */
export interface CategoryAContent {
  readonly type: "tutorial" | "github_repo" | "tool" | "ai_update" | "dev_tip";
  readonly title: string;
  readonly body: string;
  readonly sourceUrl: string;
  readonly codeExample?: string;
}

/** Category B: tech news only. 1 post/day. */
export interface CategoryBContent {
  readonly headline: string;
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly sourceUrl: string;
}

/** Category C sub-types: NASA, joke, quote, dev fact. 1 post/day, rotating. */
export type CategoryCContent =
  | NasaContent
  | JokeContent
  | QuoteContent
  | DevFactContent;

export interface NasaContent {
  readonly type: "nasa";
  readonly imageUrl: string;
  readonly title: string;
  readonly caption: string;
}

export interface JokeContent {
  readonly type: "joke";
  readonly setup: string;
  readonly punchline: string;
}

export interface QuoteContent {
  readonly type: "quote";
  readonly text: string;
  readonly author: string;
}

export interface DevFactContent {
  readonly type: "dev_fact";
  readonly fact: string;
  readonly context: string;
  readonly sourceUrl: string;
}

/** v13.0.0: Category H — Hardware & Technology Headlines.
 *  One RSS item = one Strategy candidate. Same pipeline as A/B/C. */
export interface CategoryHContent {
  readonly type: "hardware_headline" | "tech_news";
  readonly headline: string;
  readonly summary: string;
  readonly sourceUrl: string;
  readonly imageUrl?: string;
}

/** Discriminated union of all category content shapes. */
export type CategoryContent = CategoryAContent | CategoryBContent | CategoryCContent | CategoryHContent;

/** v13.0.0: All valid categories as a readonly tuple (for iteration). */
export const ALL_CATEGORIES: readonly Category[] = ["A", "B", "C", "H"] as const;

/** v13.0.0: Legacy A/B/C categories (for code that should NOT include H). */
export const ABC_CATEGORIES: readonly Category[] = ["A", "B", "C"] as const;

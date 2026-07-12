/**
 * src/types/category.ts
 * Content category system. See FREDY_GUIDELINES.md §1.
 */

/** The three content categories. */
export type Category = "A" | "B" | "C";

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

/** Discriminated union of all category content shapes. */
export type CategoryContent = CategoryAContent | CategoryBContent | CategoryCContent;

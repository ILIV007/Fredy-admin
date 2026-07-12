/**
 * src/types/queue.ts
 * Content queue types. See ARCHITECTURE_RULES.md §7.1 (fredy:queue:<category>).
 */

import type { Category } from "./category";
import type { SourceItem } from "./api";

/** An item in the content queue, waiting to be picked up by the scheduler. */
export interface QueueItem {
  readonly id: string;
  readonly category: Category;
  readonly source: string;
  readonly sourceItem: SourceItem;
  readonly enqueuedAt: number;
  readonly expiresAt: number;
  readonly attempts: number;
  readonly lastAttemptAt: number | null;
}

/** Queue depth per category, for the admin dashboard. */
export interface QueueDepth {
  readonly category: Category;
  readonly depth: number;
  readonly oldestItemAge: number | null;
}

/** Dead-letter queue item — failed N times, parked for inspection. */
export interface DeadLetterItem {
  readonly id: string;
  readonly category: Category;
  readonly source: string;
  readonly sourceItem: SourceItem;
  readonly firstAttemptAt: number;
  readonly lastAttemptAt: number;
  readonly failureCount: number;
  readonly lastError: string;
}

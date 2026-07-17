/**
 * src/types/scheduler.ts
 * Scheduler & publishing engine types.
 *
 * See Prompt 9 spec and FREDY_GUIDELINES.md §1 (posting rules).
 */

import type { Category } from "./category";
import type { ReadyContent } from "./content";
import type { QualityResult } from "./quality";

// ────────────────────────────────────────────────────────────
// Time generation
// ────────────────────────────────────────────────────────────

/** A posting window (e.g., 09:00–22:00). */
export interface PostingWindow {
  readonly start: string; // "HH:MM"
  readonly end: string; // "HH:MM"
}

/** A generated slot time for a day. */
export interface SlotTime {
  readonly index: number;
  readonly date: string; // YYYY-MM-DD
  readonly time: string; // HH:MM
  readonly epochMs: number;
  readonly category: Category;
  readonly jitterMinutes: number;
  /** Annotated at runtime by SchedulerService.status() — true if slot already fired. */
  readonly fired?: boolean;
}

// ────────────────────────────────────────────────────────────
// Daily plan
// ────────────────────────────────────────────────────────────

/** A complete daily publishing plan. */
export interface DailyPlan {
  readonly date: string; // YYYY-MM-DD
  readonly slots: readonly SlotTime[];
  readonly generatedAt: number;
  readonly timezone: string;
  readonly postsPerDay: number;
  readonly categoryDistribution: Readonly<Record<Category, number>>;
}

// ────────────────────────────────────────────────────────────
// Scheduled jobs
// ────────────────────────────────────────────────────────────

/** A job in the scheduler queue. */
export interface ScheduledJob {
  readonly id: string;
  readonly type: "scheduled" | "manual" | "retry";
  readonly scheduledTime: number;
  readonly category: Category;
  readonly source?: string;
  readonly contentId?: string;
  readonly createdAt: number;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly lastAttemptAt: number | null;
  readonly lastError: string | null;
}

/** Result of a scheduler tick. */
export interface SchedulerTickResult {
  readonly fired: boolean;
  readonly slot: SlotTime | null;
  readonly job: ScheduledJob | null;
  readonly published: PublishResult | null;
  readonly skipped: boolean;
  readonly skipReason?: string;
}

/** Scheduler status (for the dashboard). */
export interface SchedulerStatus {
  readonly enabled: boolean;
  readonly today: DailyPlan | null;
  readonly nextSlot: SlotTime | null;
  readonly queueDepth: number;
  readonly lastFiredAt: number | null;
  readonly postsPublishedToday: number;
  readonly postsByCategoryToday: Readonly<Record<Category, number>>;
}

// ────────────────────────────────────────────────────────────
// Publishing
// ────────────────────────────────────────────────────────────

/** Result of a publish attempt. */
export interface PublishResult {
  readonly ok: boolean;
  readonly contentId: string | null;
  readonly category: Category | null;
  readonly telegramMessageId: number | null;
  readonly telegramChatId: string | null;
  readonly publishedAt: number;
  readonly error?: string;
  readonly attempts: number;
}

/** Options for manual publishing. */
export interface ManualPublishOptions {
  readonly category?: Category;
  readonly source?: string;
  readonly language?: string;
  readonly simulate?: boolean;
}

// ────────────────────────────────────────────────────────────
// History
// ────────────────────────────────────────────────────────────

/** A published post history entry. */
export interface HistoryEntry {
  readonly id: string;
  readonly publishedAt: number;
  readonly pluginId: string;
  readonly category: Category;
  readonly language: string;
  readonly qualityScore: number;
  readonly telegramMessageId: number;
  readonly telegramChatId: string;
  readonly aiProvider: string;
  readonly aiModel: string;
  readonly tokensUsed: number;
  readonly estimatedCost: number;
  readonly textPreview: string;
  readonly sourceUrl: string;
}

/** History query result. */
export interface HistoryQueryResult {
  readonly entries: readonly HistoryEntry[];
  readonly total: number;
  readonly date: string;
}

// ────────────────────────────────────────────────────────────
// Re-export ReadyContent for convenience
// ────────────────────────────────────────────────────────────

export type { ReadyContent, QualityResult };

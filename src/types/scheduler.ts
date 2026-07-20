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

/** A generated slot time for a day.
 *  v11.17.0: Domain Separation — Window fields drive scheduling, time fields are display-only.
 *
 *  SCHEDULING FIELDS (used by scheduler to make publish decisions):
 *  - time (windowStart)
 *  - windowEnd
 *
 *  DISPLAY-ONLY FIELDS (for UI/analytics, NOT for scheduling):
 *  - scheduledTime (random time within window, for display)
 *  - epochMs (window start epoch, for ordering only)
 *  - publishedAt (actual publish time, set after publish)
 */
export interface SlotTime {
  readonly index: number;
  readonly date: string; // YYYY-MM-DD
  /** Window start time "HH:MM" — SCHEDULING FIELD */
  readonly time: string;
  /** Window end time "HH:MM" — SCHEDULING FIELD */
  readonly windowEnd: string;
  /** v11.17.0: Scheduled time "HH:MM" — DISPLAY ONLY (random within window) */
  readonly scheduledTime?: string;
  /** Epoch ms for window START — DISPLAY ONLY (for ordering, NOT for firing) */
  readonly epochMs: number;
  /** v11.17.0: Actual publish time (epoch ms) — set after successful publish */
  readonly publishedAt?: number;
  readonly category: Category;
  readonly jitterMinutes: number;
  /** v8.0.0: True if the slot has been fired (set by status()). */
  readonly fired?: boolean;
  /** v8.7.0: Real 3-state status from strategy plan — "published" | "failed" | "pending" | "publishing". */
  readonly status?: string;
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

/** Result of a publish attempt.
 *  v12.0.7: Added sentText + sentMediaUrl — the EXACT content sent to the
 *  channel, so the admin PM can forward the identical post (not a re-transform). */
export interface PublishResult {
  readonly ok: boolean;
  readonly contentId: string | null;
  readonly category: Category | null;
  readonly telegramMessageId: number | null;
  readonly telegramChatId: string | null;
  readonly publishedAt: number;
  readonly error?: string;
  readonly attempts: number;
  /** v12.0.7: The exact text/caption sent to the channel (after URL stripping). */
  readonly sentText?: string;
  /** v12.0.7: The exact image URL sent to the channel (null = text-only post). */
  readonly sentMediaUrl?: string | null;
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

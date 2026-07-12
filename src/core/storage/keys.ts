/**
 * src/core/storage/keys.ts
 * Centralized KV key construction. Never build KV keys inline — use these helpers.
 * See ARCHITECTURE_RULES.md §7.1 for the full key map.
 *
 * All keys MUST start with "fredy:" and use ":" as separator.
 */

import type { Category } from "../../types/category";

const PREFIX = "fredy" as const;

// ────────────────────────────────────────────────────────────
// Settings & state (per admin)
// ────────────────────────────────────────────────────────────

/** Per-admin settings blob. */
export const settingsKey = (adminId: string | number): string =>
  `${PREFIX}:settings:${adminId}`;

/** Per-admin runtime state. */
export const stateKey = (adminId: string | number): string =>
  `${PREFIX}:state:${adminId}`;

/** Channel-wide global config overrides. */
export const globalConfigKey = (): string =>
  `${PREFIX}:global:config`;

// ────────────────────────────────────────────────────────────
// Content queue & dead-letter
// ────────────────────────────────────────────────────────────

/** Queue for a category (FIFO list of pending source items). */
export const queueKey = (category: Category): string =>
  `${PREFIX}:queue:${category}`;

/** Dead-letter queue for a category. */
export const dlqKey = (category: Category): string =>
  `${PREFIX}:dlq:${category}`;

// ────────────────────────────────────────────────────────────
// Scheduler
// ────────────────────────────────────────────────────────────

/** Computed slots for a single date (YYYY-MM-DD). */
export const slotsKey = (date: string): string =>
  `${PREFIX}:sched:slots:${date}`;

/** Marker that slot N fired on date D. */
export const slotFiredKey = (date: string, slotIndex: number): string =>
  `${PREFIX}:sched:sent:${date}:${slotIndex}`;

/** Last scheduled timestamp (for interval calculation). */
export const lastScheduledKey = (channel: string): string =>
  `${PREFIX}:sched:last:${channel}`;

// ────────────────────────────────────────────────────────────
// Dedup & history
// ────────────────────────────────────────────────────────────

/** Dedup hash entry. */
export const dedupKey = (hash: string): string =>
  `${PREFIX}:dedup:${hash}`;

/** Daily published-posts summary. */
export const historyKey = (date: string): string =>
  `${PREFIX}:history:${date}`;

// ────────────────────────────────────────────────────────────
// Source caches & health
// ────────────────────────────────────────────────────────────

/** Cached fetch from a source. */
export const sourceCacheKey = (sourceName: string): string =>
  `${PREFIX}:source:${sourceName}:cache`;

/** Health status for a source. */
export const sourceHealthKey = (sourceName: string): string =>
  `${PREFIX}:source:${sourceName}:health`;

// ────────────────────────────────────────────────────────────
// Soul
// ────────────────────────────────────────────────────────────

/** Current soul.md content (overrides the bundled default). */
export const soulKey = (): string =>
  `${PREFIX}:soul`;

// ────────────────────────────────────────────────────────────
// Admin panel — stateful conversations, approve mode
// ────────────────────────────────────────────────────────────

/** Stateful conversation state (soul editor, manual post composer). */
export const conversationKey = (adminId: string | number): string =>
  `${PREFIX}:convo:${adminId}`;

/** Pending approve-mode post data. */
export const approveKey = (previewMessageId: number): string =>
  `${PREFIX}:approve:${previewMessageId}`;

// ────────────────────────────────────────────────────────────
// Debug ring buffers
// ────────────────────────────────────────────────────────────

export const debugUpdatesKey = (): string => `${PREFIX}:debug:updates`;
export const debugErrorsKey = (): string => `${PREFIX}:debug:errors`;
export const debugRawKey = (): string => `${PREFIX}:debug:raw_requests`;

// ────────────────────────────────────────────────────────────
// Media group buffering (inherited from AI Admin — for future use)
// ────────────────────────────────────────────────────────────

export const mediaGroupKey = (groupId: string, messageId: number): string =>
  `${PREFIX}:mg:${groupId}:${messageId}`;

export const mediaGroupPrefix = (groupId: string): string =>
  `${PREFIX}:mg:${groupId}:`;

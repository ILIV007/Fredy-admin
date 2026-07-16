/**
 * src/services/tick-logger.ts
 * Structured tick logger — produces a structured log entry for each tick.
 *
 * Every tick produces a TickLog entry that captures:
 *   - Tick start/end timestamps
 *   - Execution duration
 *   - Published posts count
 *   - Skipped posts count + reasons
 *   - Queue status (depths per category)
 *   - Refresh status
 *   - Errors encountered
 *   - Lock status (acquired/skipped)
 *
 * The last tick log is stored in KV for the Manager Dashboard to display.
 */

import type { KVStore } from "./kv-store";

/** Structured tick log entry. */
export interface TickLog {
  readonly tickId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly lockAcquired: boolean;
  readonly lockSkippedReason: string | null;
  readonly published: number;
  readonly skipped: number;
  readonly skipReasons: string[];
  readonly queueDepthBefore: number;
  readonly queueDepthAfter: number;
  readonly refreshed: boolean;
  readonly errors: TickError[];
  readonly quietHoursActive: boolean;
}

/** A single error during the tick pipeline. */
export interface TickError {
  readonly step: string;
  readonly message: string;
  readonly timestamp: number;
}

/** Builder for TickLog — accumulates data during the tick pipeline. */
export class TickLogBuilder {
  private tickId: string;
  private startedAt: number;
  private lockAcquired = false;
  private lockSkippedReason: string | null = null;
  private published = 0;
  private skipped = 0;
  private skipReasons: string[] = [];
  private queueDepthBefore = 0;
  private queueDepthAfter = 0;
  private refreshed = false;
  private errors: TickError[] = [];
  private quietHoursActive = false;

  constructor() {
    this.tickId = `tick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = Date.now();
  }

  setLockAcquired(acquired: boolean, reason?: string): void {
    this.lockAcquired = acquired;
    this.lockSkippedReason = reason ?? null;
  }

  incrementPublished(): void {
    this.published++;
  }

  incrementSkipped(reason: string): void {
    this.skipped++;
    this.skipReasons.push(reason);
  }

  setQueueDepth(before: number, after: number): void {
    this.queueDepthBefore = before;
    this.queueDepthAfter = after;
  }

  setRefreshed(refreshed: boolean): void {
    this.refreshed = refreshed;
  }

  addError(step: string, message: string): void {
    this.errors.push({ step, message, timestamp: Date.now() });
  }

  setQuietHours(active: boolean): void {
    this.quietHoursActive = active;
  }

  build(): TickLog {
    const endedAt = Date.now();
    return {
      tickId: this.tickId,
      startedAt: this.startedAt,
      endedAt,
      durationMs: endedAt - this.startedAt,
      lockAcquired: this.lockAcquired,
      lockSkippedReason: this.lockSkippedReason,
      published: this.published,
      skipped: this.skipped,
      skipReasons: this.skipReasons,
      queueDepthBefore: this.queueDepthBefore,
      queueDepthAfter: this.queueDepthAfter,
      refreshed: this.refreshed,
      errors: this.errors,
      quietHoursActive: this.quietHoursActive,
    };
  }
}

/** Persists tick logs to KV for dashboard display. */
export class TickLogger {
  private static readonly LAST_LOG_KEY = "fredy:tick:lastLog";
  private static readonly LOG_TTL_SECONDS = 7 * 24 * 3600; // 7 days

  constructor(private readonly kv: KVStore) {}

  /** Save the tick log to KV (overwrites the last log). */
  async save(log: TickLog): Promise<void> {
    try {
      await this.kv.setJson(TickLogger.LAST_LOG_KEY, log, TickLogger.LOG_TTL_SECONDS);
    } catch { /* non-fatal */
      // Non-fatal — logging is best-effort.
    }
  }

  /** Load the last tick log from KV. */
  async load(): Promise<TickLog | null> {
    try {
      return await this.kv.getJson<TickLog>(TickLogger.LAST_LOG_KEY);
    } catch { /* non-fatal */
      return null;
    }
  }
}

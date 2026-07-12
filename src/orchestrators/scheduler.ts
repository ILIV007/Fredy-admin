/**
 * src/orchestrators/scheduler.ts
 * Scheduler orchestrator. Wraps SchedulerService.tick() and the source-refresh
 * background job. Called by the cron entry point.
 *
 * See ARCHITECTURE_RULES.md §10.6 and FREDY_GUIDELINES.md §1.
 */

import type { Container } from "../types/env";
import type { SchedulerTickResult } from "../types/scheduler";

export class SchedulerOrchestrator {
  constructor(private readonly container: Container) {}

  /** Cron tick — fire one slot if due. Returns whether anything happened. */
  async tick(): Promise<SchedulerTickResult> {
    return this.container.scheduler.tick();
  }

  /** Refresh source caches (called every 15 min by the second cron). */
  async refreshSources(): Promise<void> {
    // TODO: implement in Phase 3 — for each enabled source, if cache older
    // than intervalMin, fetch fresh items and update the content queue.
    await Promise.resolve();
  }
}

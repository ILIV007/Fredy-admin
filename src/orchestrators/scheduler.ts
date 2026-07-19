/**
 * src/orchestrators/scheduler.ts
 * Scheduler orchestrator. Thin wrapper around SchedulerService.tick().
 *
 * v9.2.1: refreshSources() removed — it was a no-op stub (TODO never
 * implemented) whose caller in tick.ts still paid a KV write every ~2h
 * for the "fredy:tick:lastRefresh" timestamp. Source fetching already
 * happens via content.processForCategory() during maintainQueue(), so
 * this pathway was dead weight. Removed alongside the REFRESH_KEY write.
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
}

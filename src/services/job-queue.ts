/**
 * src/services/job-queue.ts
 * Scheduler job queue — stores ScheduledJob objects in KV.
 *
 * Jobs are sorted by scheduledTime. The scheduler tick pulls due jobs
 * (scheduledTime <= now) and processes them.
 *
 * See Prompt 9 spec.
 */

import { shortId } from "../primitives/hash";
import type { ScheduledJob } from "../types/scheduler";
import type { Category } from "../types/category";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

export interface JobQueueDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
}

const QUEUE_KEY = "fredy:sched:jobs";
const JOB_TTL_SECONDS = 7 * 24 * 3600; // 7 days

export class JobQueue {
  constructor(private readonly deps: JobQueueDeps) {}

  /** Enqueue a new job. */
  async enqueue(
    job: Omit<ScheduledJob, "id" | "createdAt" | "attempts" | "lastAttemptAt" | "lastError">,
  ): Promise<ScheduledJob> {
    const fullJob: ScheduledJob = {
      ...job,
      id: shortId(),
      createdAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
    };

    const queue = await this.getQueue();
    queue.push(fullJob);
    queue.sort((a, b) => a.scheduledTime - b.scheduledTime);
    await this.saveQueue(queue);

    this.deps.logger.info("scheduler.slot_fired", {
      jobId: fullJob.id,
      type: fullJob.type,
      category: fullJob.category,
      scheduledTime: new Date(fullJob.scheduledTime).toISOString(),
      message: "Job enqueued",
    });

    return fullJob;
  }

  /** Get all due jobs (scheduledTime <= now). */
  async getDueJobs(now = Date.now()): Promise<readonly ScheduledJob[]> {
    const queue = await this.getQueue();
    return queue.filter((j) => j.scheduledTime <= now);
  }

  /** Get the next job (earliest scheduledTime). */
  async peekNext(): Promise<ScheduledJob | null> {
    const queue = await this.getQueue();
    if (queue.length === 0) return null;
    return queue[0]!;
  }

  /** Remove a job from the queue (after successful publish or after max retries). */
  async remove(jobId: string): Promise<void> {
    const queue = await this.getQueue();
    const filtered = queue.filter((j) => j.id !== jobId);
    await this.saveQueue(filtered);
  }

  /** Increment a job's attempt count and record the error. */
  async incrementAttempts(jobId: string, error: string): Promise<ScheduledJob | null> {
    const queue = await this.getQueue();
    const job = queue.find((j) => j.id === jobId);
    if (!job) return null;

    const updated: ScheduledJob = {
      ...job,
      attempts: job.attempts + 1,
      lastAttemptAt: Date.now(),
      lastError: error,
    };

    const newQueue = queue.map((j) => (j.id === jobId ? updated : j));
    await this.saveQueue(newQueue);
    return updated;
  }

  /** Get all jobs (for the dashboard). */
  async list(): Promise<readonly ScheduledJob[]> {
    return this.getQueue();
  }

  /** Get jobs for a specific category. */
  async listByCategory(category: Category): Promise<readonly ScheduledJob[]> {
    const queue = await this.getQueue();
    return queue.filter((j) => j.category === category);
  }

  /** Get the queue depth. */
  async depth(): Promise<number> {
    const queue = await this.getQueue();
    return queue.length;
  }

  /** Clear all jobs. */
  async clear(): Promise<void> {
    await this.deps.kv.delete(QUEUE_KEY);
  }

  // ────────────────────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────────────────────

  private async getQueue(): Promise<ScheduledJob[]> {
    const queue = await this.deps.kv.getJson<ScheduledJob[]>(QUEUE_KEY);
    return queue ?? [];
  }

  private async saveQueue(queue: ScheduledJob[]): Promise<void> {
    await this.deps.kv.setJson(QUEUE_KEY, queue, JOB_TTL_SECONDS);
  }
}

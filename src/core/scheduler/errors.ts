/**
 * src/core/scheduler/errors.ts
 * Scheduler-specific error hierarchy. See ARCHITECTURE_RULES.md §9.3.
 */

import { AppError } from "../errors";

/** Base class for all scheduler errors. */
export class SchedulerError extends AppError {
  constructor(
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, context);
  }
}

/** Thrown when a slot time generation fails. */
export class SlotGenerationError extends SchedulerError {
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when a job is not found in the queue. */
export class JobNotFoundError extends SchedulerError {
  constructor(jobId: string) {
    super(`Job "${jobId}" not found`, { jobId });
  }
}

/** Thrown when publishing fails after all retries. */
export class PublishFailedError extends SchedulerError {
  constructor(
    public readonly contentId: string,
    public readonly attempts: number,
    public readonly lastError: string,
  ) {
    super(`Publish failed after ${attempts} attempts: ${lastError}`, { contentId, attempts, lastError });
  }
}

/** Thrown when content is rejected at publish time. */
export class PublishValidationError extends SchedulerError {
  constructor(
    message: string,
    public readonly reasons: readonly string[],
  ) {
    super(message, { reasons });
  }
}

/** Thrown when a category is disabled. */
export class CategoryDisabledError extends SchedulerError {
  constructor(category: string) {
    super(`Category "${category}" is disabled`, { category });
  }
}

/** Thrown when a plugin is disabled. */
export class PluginDisabledError extends SchedulerError {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is disabled`, { pluginId });
  }
}

/** Thrown when the scheduler is disabled. */
export class SchedulerDisabledError extends SchedulerError {
  constructor(message = "Scheduler is disabled") {
    super(message);
  }
}

/** Thrown when the daily plan cannot be generated. */
export class DailyPlanError extends SchedulerError {
  constructor(message: string) {
    super(message);
  }
}

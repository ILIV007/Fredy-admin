/**
 * src/types/debug.ts
 * Debug system types. See ARCHITECTURE_RULES.md §11.
 */

export type DebugLogLevel = "error" | "warn" | "info" | "debug";

export type DebugEventName =
  | "pipeline.start"
  | "pipeline.complete"
  | "pipeline.timeout"
  | "pipeline.error"
  | "pipeline.popularity_filter"
  | "ai.start"
  | "ai.success"
  | "ai.error"
  | "ai.fallback"
  | "ai.cancelled"
  | "source.fetch_start"
  | "source.fetch_success"
  | "source.fetch_error"
  | "source.fetch_repo_error"
  | "source.fetch_cache_hit"
  | "source.fetch_skip"
  | "source.throttled"
  | "source.api_error"
  | "scheduler.tick"
  | "scheduler.slot_fired"
  | "scheduler.skip"
  | "scheduler.stale_language"
  | "scheduler.alert"
  | "scheduler.transform_failed"
  | "scheduler.send_formatted_failed"
  | "scheduler.admin_pm_failed"
  | "quality.reject"
  | "quality.reject_fallback"
  | "quality.pass"
  | "telegram.send"
  | "telegram.error"
  | "admin.action"
  | "config.update";

/** A single debug log entry. Stored in KV ring buffers when debug mode is on. */
export interface DebugEvent {
  readonly time: number;
  readonly level: DebugLogLevel;
  readonly event: DebugEventName;
  readonly context: Readonly<Record<string, unknown>>;
}

/** A trace step within a pipeline run. */
export interface TraceStep {
  readonly step: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

/** A complete pipeline trace. */
export interface PipelineTrace {
  readonly id: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly steps: readonly TraceStep[];
  readonly category: string | null;
  readonly source: string | null;
  readonly result: "ok" | "error" | "rejected" | "timeout" | null;
}

/** A debug test endpoint registration. */
export interface DebugTest {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  run(env: import("./env").Env): Promise<unknown>;
}

/** Status of the debug system itself. */
export interface DebugStatus {
  readonly enabled: boolean;
  readonly ringBufferCapacity: number;
  readonly events: number;
  readonly errors: number;
  readonly rawRequests: number;
}

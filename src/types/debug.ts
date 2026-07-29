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
  | "pipeline.warn"
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
  | "source.fetch_no_token"
  | "source.fetch_org_error"
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
  | "config.update"
  // v11 Phase 3: Provider Engine events
  | "provider.adaptive_backoff"
  | "provider.adaptive_restore"
  | "provider.refresh_failed"
  | "provider.refresh_batch"
  // v12.0.5: Replacement pipeline events
  | "pipeline.replacement"
  | "pipeline.replacement_success"
  | "pipeline.replacement_exhausted"
  // v12.0.9: Tier V scheduled content events
  | "tierV.publish_start"
  | "tierV.publish_success"
  | "tierV.publish_failed"
  | "tierV.publish_error"
  // v12.2.1: Stuck publishing + time budget events
  | "scheduler.stuck_publishing"
  | "scheduler.time_budget_exceeded"
  | "scheduler.time_budget_failed"
  // v12.2.2: Preferred provider events
  | "scheduler.preferred_provider"
  | "scheduler.preferred_failed"
  | "scheduler.preferred_error"
  // v13.0.3: Tier H Quality Filter events
  | "tier_h_filter"
  | "tier_h_accepted"
  | "tier_h_rejected"
  // v13.0.6: Novelty Score events
  | "novelty_score"
  | "novelty_accepted"
  | "novelty_rejected"
  // v13.4.9: Duplicate forwarding events (admin PM notification)
  | "pipeline.duplicate_forward"
  | "scheduler.duplicate_forward_failed"
  | "scheduler.duplicate_forward_item_failed";

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

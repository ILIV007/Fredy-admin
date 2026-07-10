/**
 * src/orchestrators/pipeline.ts
 * Content generation pipeline. Composes services into the workflow:
 *   fetch → categorize → generate → soul-inject → quality-filter → publish
 *
 * See ARCHITECTURE_RULES.md §10.4 (Fredy pipeline) and §3 (Layer 3).
 *
 * Framework inherited from AI Admin src/pipeline.js: timeout + AbortController +
 * trace. Stages are different (generation, not editing).
 */

import { PIPELINE_TIMEOUT_MS } from "../core/constants";
import type { Category } from "../types/category";
import type { Container } from "../types/env";
import type { Post, PublishedPost, RejectedPost } from "../types/post";
import type { PipelineTrace, TraceStep } from "../types/debug";
import { shortId } from "../primitives/hash";

export interface PipelineResult {
  readonly ok: boolean;
  readonly post: Post | null;
  readonly published: PublishedPost | null;
  readonly rejected: RejectedPost | null;
  readonly trace: PipelineTrace;
  readonly error?: string;
}

export interface PipelineOptions {
  readonly category?: Category;
  readonly source?: string;
  readonly simulate?: boolean;
}

export class PipelineOrchestrator {
  constructor(private readonly container: Container) {}

  /** Run the full pipeline. Times out after PIPELINE_TIMEOUT_MS. */
  async run(options: PipelineOptions = {}): Promise<PipelineResult> {
    const traceId = shortId();
    const startedAt = Date.now();
    const steps: TraceStep[] = [];
    const traceStep = (step: string, ok: boolean, detail = ""): void => {
      steps.push({
        step,
        ok,
        detail,
        ms: Date.now() - startedAt,
      });
    };

    const trace: PipelineTrace = {
      id: traceId,
      startedAt,
      finishedAt: null,
      steps,
      category: options.category ?? null,
      source: options.source ?? null,
      result: null,
    };

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      PIPELINE_TIMEOUT_MS,
    );

    try {
      const result = await this.runInner(options, traceStep, timeoutController.signal);
      trace.finishedAt = Date.now();
      trace.result = result.ok ? "ok" : result.rejected ? "rejected" : "error";
      return { ...result, trace };
    } catch (error) {
      trace.finishedAt = Date.now();
      trace.result = "timeout";
      traceStep("aborted", false, error instanceof Error ? error.message : String(error));
      return {
        ok: false,
        post: null,
        published: null,
        rejected: null,
        trace,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Inner pipeline — broken out so the timeout wrapper can abort it. */
  private async runInner(
    options: PipelineOptions,
    traceStep: (step: string, ok: boolean, detail?: string) => void,
    signal: AbortSignal,
  ): Promise<Omit<PipelineResult, "trace">> {
    void signal;

    // Step 1: pick category
    traceStep("category", true, options.category ?? "auto");
    // TODO: real impl in Phase 4.

    // Step 2: fetch from source
    traceStep("fetch", true, options.source ?? "auto");
    // TODO: real impl in Phase 4.

    // Step 3: AI generate
    traceStep("generate", true, "skeleton");
    // TODO: real impl in Phase 2.

    // Step 4: soul inject (handled inside AIService.generate)

    // Step 5: format
    traceStep("format", true, "html");
    // TODO: real impl in Phase 6.

    // Step 6: quality filter
    traceStep("quality", true, "skeleton");
    // TODO: real impl in Phase 4.

    // Step 7: publish (or skip if simulate)
    if (options.simulate) {
      traceStep("publish", true, "skipped (simulate)");
    } else {
      traceStep("publish", true, "skeleton");
    }

    return {
      ok: false,
      post: null,
      published: null,
      rejected: null,
      error: "Pipeline not implemented (scaffold)",
    };
  }
}

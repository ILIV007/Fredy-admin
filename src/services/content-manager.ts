/**
 * src/services/content-manager.ts
 * Content Manager — orchestrates the full content pipeline:
 *
 *   Plugin → Normalize → Enrich → Tag → Validate → Duplicate Check
 *         → Category Resolve → AI Engine → Quality Score → Format → Ready Queue
 *
 * See Prompt 8 + 11 spec. Outputs clean structured ReadyContent objects for the Scheduler.
 */

import type { Category } from "../types/category";
import type { SourceItem } from "../types/api";
import type {
  ContentItem,
  ReadyContent,
  PipelineResult,
  PipelineStage,
  RejectionReason,
  StandardPost,
} from "../types/content";
import type { FredySettings } from "../types/config";
import type { PluginManager } from "./plugin-manager";
import type { ContentValidator } from "./content-validator";
import type { CategoryResolver } from "./category-resolver";
import type { DuplicateDetector } from "./duplicate-detector";
import type { ContentFormatter } from "./content-formatter";
import type { ContentNormalizer } from "./content-normalizer";
import type { EnrichmentEngine } from "./enrichment-engine";
import type { TaggingSystem } from "./tagging-system";
import type { ContentQueue } from "./content-queue";
import type { AIService } from "./ai-service";
import type { SoulLoader } from "./soul-loader";
import type { Logger } from "./logger";

export interface ContentManagerDeps {
  readonly pluginManager: PluginManager;
  readonly validator: ContentValidator;
  readonly categoryResolver: CategoryResolver;
  readonly duplicateDetector: DuplicateDetector;
  readonly formatter: ContentFormatter;
  readonly normalizer: ContentNormalizer;
  readonly enrichmentEngine: EnrichmentEngine;
  readonly taggingSystem: TaggingSystem;
  readonly queue: ContentQueue;
  readonly ai: AIService;
  readonly soul: SoulLoader;
  readonly logger: Logger;
  readonly settings: () => Promise<FredySettings>;
}

export class ContentManager {
  constructor(private readonly deps: ContentManagerDeps) {}

  /**
   * Run one source item through the full pipeline.
   * Returns a PipelineResult with either a ReadyContent or a rejection reason.
   *
   * Pipeline: Normalize → Enrich → Tag → Validate → Dedup → Category → AI → Quality → Format → Enqueue
   */
  async process(
    sourceItem: SourceItem,
    language?: string,
    options?: { skipDedup?: boolean },
  ): Promise<PipelineResult> {
    const settings = await this.deps.settings();
    const lang = language ?? settings.language.default;
    const skipDedup = options?.skipDedup ?? false;

    // ── Stage 1: Normalize (SourceItem → StandardPost) ─────
    let post: StandardPost;
    try {
      post = await this.deps.normalizer.normalize(sourceItem, lang);
    } catch (error) {
      return this.reject("normalize", "empty_content", `Normalization failed: ${this.errMsg(error)}`, null);
    }

    // ── Stage 2: Enrich (add provider-specific metadata) ───
    try {
      post = await this.deps.enrichmentEngine.enrich(post);
    } catch (error) {
      this.deps.logger.warn("quality.reject", {
        contentId: post.id,
        source: post.source,
        error: this.errMsg(error),
        stage: "enrich",
        message: "Enrichment failed, continuing with basic data",
      });
    }

    // ── Stage 3: Tag (auto-assign tags) ────────────────────
    post = this.deps.taggingSystem.assignTags(post);

    // Build a ContentItem from the StandardPost for the validator + downstream.
    const item: ContentItem = {
      id: post.id,
      pluginId: post.source,
      title: post.title,
      body: post.body,
      category: post.category,
      source: post.source,
      language: post.language,
      url: post.url,
      media: post.media,
      fetchedAt: sourceItem.fetchedAt,
      raw: sourceItem,
    };

    // ── Stage 4: Validate ──────────────────────────────────
    const validation = this.deps.validator.validate(item);
    if (!validation.ok) {
      const reason = this.categorizeValidationErrors(validation.errors);
      return this.reject("validate", reason, validation.errors.join("; "), item);
    }

    // ── Stage 5: Duplicate Check (skip for manual triggers) ──
    if (!skipDedup) {
      const dupCheck = await this.deps.duplicateDetector.check(item);
      if (dupCheck.isDuplicate) {
        const reason = `duplicate_${dupCheck.reason}` as RejectionReason;
        return this.reject("duplicate_check", reason, `Duplicate (${dupCheck.reason}) of ${dupCheck.existingId}`, item);
      }
    }

    // ── Stage 6: Category Resolve ──────────────────────────
    const categoryResult = this.deps.categoryResolver.resolve(item);
    if (categoryResult.mismatch) {
      this.deps.logger.warn("quality.reject", {
        contentId: item.id,
        pluginId: item.pluginId,
        mismatch: true,
        message: "Category mismatch — using plugin category anyway",
      });
    }
    // Use the resolved category (trusts plugin).
    const resolvedItem: ContentItem = { ...item, category: categoryResult.category };

    // ── Stage 7: AI Generate ───────────────────────────────
    const soul = await this.deps.soul.load();
    const aiResult = await this.deps.ai.generate({
      category: resolvedItem.category,
      source: resolvedItem.pluginId,
      raw: sourceItem,
      language: resolvedItem.language,
      soul,
      promptProfile: settings.ai.promptProfile,
    });

    if (!aiResult.content) {
      // ── FORMAT-ONLY FALLBACK (AI truly failed) ────────────
      // When AI fails completely (rate limit, timeout, parse error),
      // publish with format-only mode using the raw source body.
      this.deps.logger.warn("ai.fallback", {
        contentId: resolvedItem.id,
        error: aiResult.error ?? "AI failed",
        attempts: aiResult.attempts,
        message: "AI failed — using format-only fallback",
      });
      console.log("[content] AI FAILED — format-only fallback triggered");
      console.log("[content] AI error:", aiResult.error);
      console.log("[content] AI attempts:", JSON.stringify(aiResult.attempts));
      const fallbackContent = {
        text: resolvedItem.body || resolvedItem.title,
        aiConfidence: 0,
        generatedLanguage: lang === "auto" ? "en" : lang,
        headline: resolvedItem.title,
        notes: "format-only (AI unavailable)",
      };
      const fallbackQuality = {
        passed: true,
        overallScore: Math.max(aiResult.quality?.overallScore ?? 0, 1), // Keep real score
        dimensionScores: [],
        hardReject: false,
        minScore: settings.ai.qualityThreshold,
      };
      try {
        const readyContent = await this.deps.formatter.buildReadyContent(
          resolvedItem,
          fallbackContent,
          fallbackQuality as never,
          "format-only",
          "none",
          0,
          0,
        );
        if (!skipDedup) await this.deps.duplicateDetector.record(item);
        await this.deps.queue.enqueue(readyContent);
        return { ok: true, content: readyContent, item, stage: "complete", aiDebug: {
          error: aiResult.error ?? "AI failed",
          attempts: aiResult.attempts,
          usedFallback: true,
          fallbackReason: "AI returned no content",
        } };
      } catch (error) {
        return this.reject("format", "ai_failed", `Format-only fallback failed: ${this.errMsg(error)}`, item);
      }
    }

    // ── Stage 8: Quality Score ─────────────────────────────
    // AI succeeded but quality may be below threshold.
    // Use AI content anyway with threshold-bumped score (format-only fallback).
    if (!aiResult.quality || !aiResult.quality.passed) {
      const reason = aiResult.quality?.hardReject ? "quality_hard_reject" : "quality_below_threshold";
      const detail = aiResult.quality?.hardRejectReason ?? `Score ${aiResult.quality?.overallScore ?? 0} < ${settings.ai.qualityThreshold}`;
      this.deps.logger.warn("quality.reject_fallback", {
        contentId: resolvedItem.id,
        reason,
        detail,
        message: "Quality below threshold — using format-only fallback",
      });
      // Use the AI content anyway with a score at threshold.
      const realScore = aiResult.quality?.overallScore ?? 0;
      const fallbackQuality = {
        passed: true,
        overallScore: realScore, // Keep real score
        dimensionScores: aiResult.quality?.dimensionScores ?? [],
        hardReject: false,
        minScore: settings.ai.qualityThreshold,
      };
      post = { ...post, score: realScore };
      try {
        const readyContent = await this.deps.formatter.buildReadyContent(
          resolvedItem,
          aiResult.content!,
          fallbackQuality as never,
          aiResult.provider,
          aiResult.model,
          aiResult.tokensUsed,
          aiResult.estimatedCost,
        );
        if (!skipDedup) await this.deps.duplicateDetector.record(item);
        await this.deps.queue.enqueue(readyContent);
        return { ok: true, content: readyContent, item, stage: "complete" };
      } catch (error) {
        return this.reject("format", "ai_failed", `Format fallback failed: ${this.errMsg(error)}`, item);
      }
    }

    // Attach quality score to the StandardPost.
    post = { ...post, score: aiResult.quality.overallScore };

    // ── Stage 9: Format ────────────────────────────────────
    let readyContent: ReadyContent;
    try {
      readyContent = await this.deps.formatter.buildReadyContent(
        resolvedItem,
        aiResult.content,
        aiResult.quality,
        aiResult.provider,
        aiResult.model,
        aiResult.tokensUsed,
        aiResult.estimatedCost,
      );
    } catch (error) {
      return this.reject("format", "ai_failed", `Formatting failed: ${this.errMsg(error)}`, item);
    }

    // ── Stage 8: Record in dedup store ──────────────────────
    if (!skipDedup) await this.deps.duplicateDetector.record(item);

    // ── Stage 9: Enqueue ────────────────────────────────────
    await this.deps.queue.enqueue(readyContent);

    return {
      ok: true,
      content: readyContent,
      item,
      stage: "complete",
    };
  }

  /**
   * Fetch and process one item from a specific plugin.
   * Returns the PipelineResult.
   */
  async processFromPlugin(
    pluginId: string,
    language?: string,
  ): Promise<PipelineResult> {
    const item = await this.deps.pluginManager.fetchOne(pluginId);
    if (!item) {
      return this.reject("normalize", "empty_content", `Plugin "${pluginId}" returned no items`, null);
    }
    return this.process(item, language);
  }

  /**
   * Fetch and process one item for a category.
   * Picks the best available plugin (enabled, healthy, anti-repeat).
   */
  async processForCategory(
    category: Category,
    lastSource: string | null = null,
    language?: string,
  ): Promise<PipelineResult> {
    const fetchResult = await this.deps.pluginManager.fetchForCategory(category, lastSource);
    if (!fetchResult) {
      return this.reject("normalize", "empty_content", `No items available for category ${category}`, null);
    }

    // Try each item until one passes the pipeline.
    for (const item of fetchResult.items) {
      const result = await this.process(item, language);
      if (result.ok) return result;
      // Otherwise, try the next item.
      this.deps.logger.info("pipeline.error", {
        contentId: item.id,
        pluginId: fetchResult.source,
        stage: result.stage,
        error: result.error,
        message: "Trying next item from plugin",
      });
    }

    return this.reject("complete", "quality_below_threshold", `All items from "${fetchResult.source}" were rejected`, null);
  }

  /**
   * Dequeue a ready content item for the scheduler to publish.
   */
  async dequeue(category: Category): Promise<ReadyContent | null> {
    const queued = await this.deps.queue.dequeue(category);
    return queued?.content ?? null;
  }

  /**
   * Get queue depths (for the dashboard).
   */
  async queueDepths() {
    return this.deps.queue.depth();
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  /** Build a rejection result. */
  private reject(
    stage: PipelineStage,
    reason: RejectionReason,
    error: string,
    item: ContentItem | null,
  ): PipelineResult {
    this.deps.logger.warn("quality.reject", {
      contentId: item?.id,
      pluginId: item?.pluginId,
      stage,
      reason,
      error,
    });
    return {
      ok: false,
      content: null,
      item,
      stage: "rejected",
      error,
      rejectedReason: reason,
    };
  }

  /** Categorize validation errors into a RejectionReason. */
  private categorizeValidationErrors(errors: readonly string[]): RejectionReason {
    const joined = errors.join("; ").toLowerCase();
    if (joined.includes("empty") || joined.includes("too short")) return "empty_content";
    if (joined.includes("language")) return "unsupported_language";
    if (joined.includes("media")) return "invalid_media";
    if (joined.includes("source") || joined.includes("plugin")) return "invalid_source";
    return "empty_content";
  }

  /** Extract error message. */
  private errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

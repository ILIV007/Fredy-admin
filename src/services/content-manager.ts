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
import type { PopularityFilter } from "./popularity-filter";
import type { FreshnessFilter } from "./freshness-filter";
import type { ContentEnricher } from "./content-enricher";
import type { CandidateRanker } from "./candidate-ranker";
import type { PipelineLogger } from "./pipeline-logger";

export interface ContentManagerDeps {
  readonly pluginManager: PluginManager;
  readonly validator: ContentValidator;
  readonly categoryResolver: CategoryResolver;
  readonly duplicateDetector: DuplicateDetector;
  readonly formatter: ContentFormatter;
  readonly normalizer: ContentNormalizer;
  readonly enrichmentEngine: EnrichmentEngine;
  readonly taggingSystem: TaggingSystem;
  readonly popularityFilter: PopularityFilter;
  readonly freshnessFilter: FreshnessFilter;
  readonly contentEnricher: ContentEnricher;
  readonly candidateRanker: CandidateRanker;
  readonly pipelineLogger: PipelineLogger;
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
   * v7 Pipeline: Normalize → Enrich → Tag → Validate → Freshness → Dedup
   *             → ContentEnricher → Category → Rank → AI → Quality → Format → Enqueue
   *
   * Each stage is isolated. If one fails, the pipeline continues when possible.
   */
  async process(
    sourceItem: SourceItem,
    language?: string,
    options?: { skipDedup?: boolean; skipEnqueue?: boolean },
  ): Promise<PipelineResult> {
    const settings = await this.deps.settings();
    const lang = language ?? settings.language.default;
    const skipDedup = options?.skipDedup ?? false;
    const skipEnqueue = options?.skipEnqueue ?? false;

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

    // ── Stage 4: Local Validation ─────────────────────────
    const validation = this.deps.validator.validate(item);
    if (!validation.ok) {
      const reason = this.categorizeValidationErrors(validation.errors);
      return this.reject("validate", reason, validation.errors.join("; "), item);
    }

    // ── Stage 5: Freshness Filter (NEW — reject stale content) ──
    const freshnessResult = this.deps.freshnessFilter.check(sourceItem, item.category);
    if (!freshnessResult.fresh) {
      this.deps.logger.info("pipeline.popularity_filter", {
        contentId: item.id,
        stage: "freshness",
        reason: freshnessResult.reason,
        ageHours: freshnessResult.ageHours.toFixed(1),
        message: "Content rejected by freshness filter",
      });
      return this.reject("validate", "empty_content", `Stale content: ${freshnessResult.reason}`, item);
    }

    // ── Stage 6: Duplicate Check ──────────────────────────
    if (!skipDedup) {
      const dupCheck = await this.deps.duplicateDetector.check(item);
      if (dupCheck.isDuplicate) {
        const reason = `duplicate_${dupCheck.reason}` as RejectionReason;
        return this.rejectDuplicate(item, reason, `Duplicate (${dupCheck.reason}) of ${dupCheck.existingId}`, dupCheck.existingId ?? "", dupCheck.reason ?? "hash");
      }
    }

    // ── Stage 7: Content Enrichment (NEW — enrich without AI) ──
    // This is the user's suggestion: fetch additional metadata from APIs
    // (GitHub stars, HN score, etc.) BEFORE sending to AI. This way AI
    // works on richer data without additional token cost.
    let enrichedItem = sourceItem;
    try {
      enrichedItem = await this.deps.contentEnricher.enrich(sourceItem);
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: sourceItem.source,
        step: "content_enricher",
        error: this.errMsg(error),
        message: "Content enrichment failed, continuing with original data",
      });
    }

    // Re-normalize the enriched item if enrichment changed it.
    if (enrichedItem !== sourceItem) {
      try {
        const enrichedPost = await this.deps.normalizer.normalize(enrichedItem, lang);
        // Preserve tags from the original post.
        post = { ...enrichedPost, tags: post.tags, score: post.score };
      } catch { /* non-fatal */
        // If re-normalization fails, keep the original post.
      }
    }

    // ── Stage 8: Category Resolve ──────────────────────────
    const categoryResult = this.deps.categoryResolver.resolve(item);
    if (categoryResult.mismatch) {
      this.deps.logger.warn("quality.reject", {
        contentId: item.id,
        pluginId: item.pluginId,
        mismatch: true,
        message: "Category mismatch — using plugin category anyway",
      });
    }
    const resolvedItem: ContentItem = { ...item, category: categoryResult.category };

    // ── Stage 9: Candidate Ranking (NEW — local scoring) ──
    const rankResult = this.deps.candidateRanker.score(enrichedItem, resolvedItem.category);
    this.deps.logger.info("pipeline.start", {
      contentId: item.id,
      stage: "candidate_ranking",
      score: rankResult.score,
      factors: rankResult.factors,
      message: "Candidate ranked",
    });

    // ── Stage 10: AI Generate ──────────────────────────────
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
        if (!skipEnqueue) await this.deps.queue.enqueue(readyContent);
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
    // IMPORTANT: if quality is below threshold, REJECT immediately — do NOT
    // enqueue. Previously, the code enqueued low-quality content with a fake
    // `passed: true`, which wasted a queue slot and AI tokens (the content
    // would later be rejected by finalPublisher anyway). Now we reject here
    // so the caller (processForCategory) can try the next source item.
    if (!aiResult.quality || !aiResult.quality.passed) {
      const reason = aiResult.quality?.hardReject ? "quality_hard_reject" : "quality_below_threshold";
      const detail = aiResult.quality?.hardRejectReason ?? `Score ${aiResult.quality?.overallScore ?? 0} < ${settings.ai.qualityThreshold}`;
      this.deps.logger.warn("quality.reject", {
        contentId: resolvedItem.id,
        reason,
        detail,
        score: aiResult.quality?.overallScore ?? 0,
        threshold: settings.ai.qualityThreshold,
        message: "Quality below threshold — rejecting (not enqueuing)",
      });
      return this.reject(
        "quality_score",
        reason,
        `Quality ${aiResult.quality?.overallScore ?? 0} < ${settings.ai.qualityThreshold}: ${detail}`,
        item,
      );
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
    if (!skipEnqueue) await this.deps.queue.enqueue(readyContent);

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
    options?: { skipDedup?: boolean; skipEnqueue?: boolean },
  ): Promise<PipelineResult> {
    const item = await this.deps.pluginManager.fetchOne(pluginId);
    if (!item) {
      return this.reject("normalize", "empty_content", `Plugin "${pluginId}" returned no items`, null);
    }
    return this.process(item, language, options);
  }

  /**
   * Fetch and process one item for a category.
   * Picks the best available plugin (enabled, healthy, anti-repeat).
   *
   * NEW (v6.5.0): items are pre-filtered by popularity before entering
   * the AI pipeline. Items without popularity metadata (e.g., XKCD,
   * jokes, NASA APOD) are exempt. For GitHub plugins, a hard minimum-
   * stars gate is applied on top of the popularity score.
   */
  async processForCategory(
    category: Category,
    lastSource: string | null = null,
    language?: string,
    options?: { skipDedup?: boolean; skipEnqueue?: boolean },
  ): Promise<PipelineResult> {
    const fetchResult = await this.deps.pluginManager.fetchForCategory(category, lastSource);
    if (!fetchResult) {
      return this.reject("normalize", "empty_content", `No items available for category ${category}`, null);
    }

    // ── Pre-filter by popularity (saves AI tokens + improves quality) ──
    // Items are sorted by popularity descending so the AI pipeline tries
    // the most popular items first.
    const filtered = this.deps.popularityFilter.filter([...fetchResult.items]);

    // Hard minimum-stars gate for GitHub plugins (catches the
    // "1-star repo gets through" bug even when the log-score is ok).
    const starFiltered = filtered.filter((item) => this.deps.popularityFilter.meetsMinStars(item));

    // Hard minimum-score/reactions gate for HN/StackExchange/Dev.to.
    const scoreFiltered = starFiltered.filter((item) => this.deps.popularityFilter.meetsMinScore(item));

    this.deps.logger.info("pipeline.popularity_filter", {
      category,
      pluginId: fetchResult.source,
      rawCount: fetchResult.items.length,
      afterPopularity: filtered.length,
      afterStars: starFiltered.length,
      afterScore: scoreFiltered.length,
    });

    // If popularity filter removed everything, fall back to original list
    // (better to publish something than nothing — the AI quality gate will
    // still catch low-quality content).
    const candidates = scoreFiltered.length > 0 ? scoreFiltered : fetchResult.items;

    // Try each item until one passes the pipeline.
    for (const item of candidates) {
      const result = await this.process(item, language, options);
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

  /** Build a duplicate-rejection result. Carries info about the
   *  previously-published item so the caller (manual path) can route
   *  the duplicate to the admin PM instead of the channel. */
  private rejectDuplicate(
    item: ContentItem | null,
    reason: RejectionReason,
    error: string,
    existingId: string,
    dupReason: "url" | "hash" | "title",
  ): PipelineResult {
    this.deps.logger.warn("quality.reject", {
      contentId: item?.id,
      pluginId: item?.pluginId,
      stage: "duplicate_check",
      reason,
      error,
      existingId,
    });
    return {
      ok: false,
      content: null,
      item,
      stage: "rejected",
      error,
      rejectedReason: reason,
      duplicateOf: {
        contentId: existingId,
        reason: dupReason,
      },
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

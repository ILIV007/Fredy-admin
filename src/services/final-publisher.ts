/**
 * src/services/final-publisher.ts
 * Final Publishing Engine — converts ReadyContent into FinalPost and publishes to Telegram.
 *
 * Pipeline (Prompt 13):
 *   ReadyContent → UX Layer (hook + humanize) → FinalPost → Telegram Publisher
 *
 * Quality Gate (HARD RULE):
 *   If score < 60 → reject, do NOT publish, move to next content.
 *
 * Failure Handling:
 *   1. Retry once (max 2 retries total)
 *   2. If fail again → log error, skip post, continue queue
 *
 * Publishing:
 *   - sendMessage (text posts)
 *   - sendPhoto (media posts)
 *   - HTML formatting
 *   - Safe link handling (blockquote)
 */

import type { ReadyContent, FinalPost } from "../types/content";
import type { PublishResult } from "../types/scheduler";
import type { UXLayer } from "./ux-layer";
import type { PublishValidator } from "./publish-validator";
import type { RetryManager } from "./retry-manager";
import type { HistoryService } from "./history-service";
import type { TelegramService } from "./telegram";
import type { FredySettings } from "../types/config";
import type { Logger } from "./logger";

export interface FinalPublisherDeps {
  readonly tg: TelegramService;
  readonly uxLayer: UXLayer;
  readonly validator: PublishValidator;
  readonly retryManager: RetryManager;
  readonly history: HistoryService;
  readonly logger: Logger;
  readonly settings: () => Promise<FredySettings>;
  /** v11.7.0: Unified image resolver */
  readonly imageResolver?: import("./image-resolver").ImageResolver;
}

/** Max retries (0 = no retries, just 1 attempt). */
const MAX_RETRIES = 1;

export class FinalPublisher {
  /** Debug info from last publish attempt (for error reporting). */
  public _lastPublishDebug: Record<string, unknown> | null = null;

  constructor(private readonly deps: FinalPublisherDeps) {}

  /** Full pipeline: ReadyContent → UX Layer → Telegram. */
  async publish(content: ReadyContent): Promise<PublishResult> {
    const startTime = Date.now();
    const settings = await this.deps.settings();
    const minScore = settings.ai.qualityThreshold;

    // ── Quality Gate (HARD RULE) ────────────────────────────
    if (content.quality.overallScore < minScore) {
      this.deps.logger.warn("quality.reject", {
        contentId: content.id,
        score: content.quality.overallScore,
        minScore,
        message: "Quality gate: score below threshold, skipping",
      });
      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: `Quality score ${content.quality.overallScore} < ${minScore}`,
        attempts: 0,
      };
    }

    // ── Publish Validation ──────────────────────────────────
    const validation = await this.deps.validator.validate(content);
    if (!validation.ok) {
      this.deps.logger.warn("quality.reject", {
        contentId: content.id,
        reasons: validation.reasons,
        message: "Publish validation failed",
      });
      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error: validation.reasons.join("; "),
        attempts: 0,
      };
    }

    // ── UX Layer: transform to FinalPost ───────────────────
    const finalPost = await this.deps.uxLayer.transform(content);

    this.deps.logger.info("pipeline.start", {
      contentId: content.id,
      hook: finalPost.hook,
      category: finalPost.category,
      hasMedia: !!finalPost.media,
      score: finalPost.score,
      message: "Final post assembled",
    });

    // ── Publish to Telegram with retry ──────────────────────
    const retryResult = await this.deps.retryManager.execute(
      () => this.publishToTelegram(finalPost),
      { maxRetries: MAX_RETRIES },
    );

    if (!retryResult.ok || !retryResult.value) {
      // All retries failed — log, skip, continue.
      const error = retryResult.error ?? "Unknown error";
      
      // Capture debug info for the error report.
      const cleanText = this.stripBareUrls(finalPost.fullText);
      this._lastPublishDebug = {
        error,
        fullText: finalPost.fullText,
        cleanText,
        cleanTextLength: cleanText.length,
        hasUrl: /https?:\/\//i.test(cleanText),
        hasHref: /<a\s+href/i.test(cleanText),
        hasAtMention: /@[a-zA-Z]/.test(cleanText),
        channel: settings?.telegram?.targetChannel ?? "@ILIVIR3",
        parseMode: settings?.telegram?.parseMode ?? "HTML",
        sourceUrl: content.sourceUrl,
        contentText: content.text,
        contentTextLength: content.text?.length ?? 0,
        headline: content.headline,
        hook: finalPost.hook,
        body: finalPost.body,
        takeaway: finalPost.takeaway,
        fullPostKeys: Object.keys(finalPost),
        hasMedia: !!finalPost.media,
        mediaType: finalPost.media?.type,
        mediaUrl: finalPost.media?.url,
        caption: finalPost.caption,
        retryAttempts: retryResult.attempts,
      };
      
      this.deps.logger.error("telegram.error", {
        contentId: content.id,
        error,
        attempts: retryResult.attempts,
        message: "Publish failed after retries, skipping post",
      });

      // Record failure in history.
      await this.deps.history.recordFailed(content, error);

      return {
        ok: false,
        contentId: content.id,
        category: content.category,
        telegramMessageId: null,
        telegramChatId: null,
        publishedAt: Date.now(),
        error,
        attempts: retryResult.attempts,
      };
    }

    const { messageId, chatId } = retryResult.value;

    // ── Record success in history ───────────────────────────
    await this.deps.history.recordPublished(content, messageId, chatId);

    this.deps.logger.info("telegram.send", {
      contentId: content.id,
      hook: finalPost.hook,
      messageId,
      chatId,
      attempts: retryResult.attempts,
      durationMs: Date.now() - startTime,
      message: "Published successfully",
    });

    return {
      ok: true,
      contentId: content.id,
      category: content.category,
      telegramMessageId: messageId,
      telegramChatId: chatId,
      publishedAt: Date.now(),
      attempts: retryResult.attempts,
    };
  }

  /** Publish a FinalPost to Telegram (text or photo).
   *  v11.7.0: Uses unified ImageResolver — no fallback logos. */
  private async publishToTelegram(
    post: FinalPost,
  ): Promise<{ messageId: number; chatId: string }> {
    const settings = await this.deps.settings();
    const channel = settings?.telegram?.targetChannel ?? "@ILIVIR3";
    const parseMode = settings?.telegram?.parseMode ?? "HTML";

    // CRITICAL: Strip ALL bare URLs from text before sending to Telegram.
    const cleanText = this.stripBareUrls(post.fullText);
    const cleanCaption = this.stripBareUrls(post.caption || "");

    // ── v11.7.0: Unified Image Resolution ──────────────────
    // Priority: post.media → ImageResolver (og:image, twitter:image, etc.)
    // NO fallback logos — if no real image, send text-only.
    let coverUrl: string | null = null;

    // 1. Check if post already has media from the pipeline.
    if (post.media && post.media.type === "image" && post.media.url) {
      coverUrl = post.media.url;
    }

    // 2. Use ImageResolver if available and no media yet.
    if (!coverUrl && this.deps.imageResolver && post.sourceUrl) {
      try {
        // Reconstruct a minimal SourceItem for the resolver.
        const fakeItem = {
          id: "",
          source: "",
          category: "A" as const,
          title: "",
          body: "",
          url: post.sourceUrl,
          fetchedAt: Date.now(),
        };
        const resolved = await this.deps.imageResolver.resolve(fakeItem);
        if (resolved) {
          coverUrl = resolved.url;
          this.deps.logger.info("pipeline.start", {
            stage: "image_publish",
            imageSource: resolved.source,
            imageUrl: resolved.url,
            message: "Image resolved for publishing",
          });
        }
      } catch { /* non-fatal — text-only is acceptable */ }
    }

    // 3. Old fallback resolver (for backward compat if ImageResolver not wired).
    if (!coverUrl && !this.deps.imageResolver && post.sourceUrl) {
      coverUrl = await this.resolveSourceCoverImage(post.sourceUrl);
    }

    // Validate image format.
    if (coverUrl) {
      const normalized = coverUrl.toLowerCase().split("?")[0] ?? "";
      if (normalized.match(/\.(ico|gif|svg|bmp|tiff|html?|php)$/)) {
        coverUrl = null;
      }
    }

    if (coverUrl) {
      try {
        const result = await this.deps.tg.sendPhoto(
          channel,
          coverUrl,
          cleanCaption,
          { parse_mode: parseMode },
        );

        if (!result.ok || !result.result) {
          throw new Error(`Telegram sendPhoto failed: ${result.description ?? "unknown"} (error_code: ${result.error_code ?? "?"})`);
        }

        return {
          messageId: result.result.message_id,
          chatId: String(result.result.chat?.id ?? channel),
        };
      } catch {
        // sendPhoto failed — fall through to text-only.
        this.deps.logger.warn("telegram.error", {
          error: "sendPhoto failed, falling back to text-only",
          imageUrl: coverUrl,
        });
      }
    }

    // ── Text-only post ──────────────────────────────────────
    const result = await this.deps.tg.sendMessage(channel, cleanText, {
      parse_mode: parseMode,
    });

    if (!result.ok || !result.result) {
      throw new Error(`Telegram sendMessage failed: ${result.description ?? "unknown"} (error_code: ${result.error_code ?? "?"})`);
    }

    return {
      messageId: result.result.message_id,
      chatId: String(result.result.chat?.id ?? channel),
    };
  }

  /**
   * v11.7.0: Legacy image resolver — kept as backward-compat fallback.
   * The new ImageResolver service is preferred. This method NO LONGER
   * returns fallback logos — if no real image is found, returns null.
   */
  private async resolveSourceCoverImage(sourceUrl: string): Promise<string | null> {
    try {
      const parsed = new URL(sourceUrl);
      const lower = sourceUrl.toLowerCase().split("?")[0] ?? "";

      // Case 1: source URL is itself an image.
      if (lower.match(/\.(jpg|jpeg|png|webp)$/)) {
        return sourceUrl;
      }

      // Case 2: GitHub repo → social preview.
      const ghMatch = parsed.hostname === "github.com"
        ? /github\.com\/([^/]+)\/([^/]+)/i.exec(sourceUrl)
        : null;
      if (ghMatch) {
        const [, owner, repo] = ghMatch;
        return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
      }

      // Case 3: Dev.to article → use cover_image from API.
      if (parsed.hostname === "dev.to") {
        const articleMatch = /dev\.to\/([^/]+)\/([^/?#]+)/i.exec(sourceUrl);
        if (articleMatch) {
          try {
            const apiRes = await fetch(`https://dev.to/api/articles/${articleMatch[1]}/${articleMatch[2]}`, {
              headers: { "User-Agent": "FredyBot/1.0" },
            });
            if (apiRes.ok) {
              const article = await apiRes.json() as { cover_image?: string };
              if (article.cover_image) return article.cover_image;
            }
          } catch { /* non-fatal */ }
        }
      }

      // v11.7.0: NO FALLBACK LOGOS — removed providerLogos.
      // If og:image can't be fetched, return null (text-only post).
      // A low-quality placeholder is worse than no image.

      // Case 4: HTML page → fetch og:image.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(sourceUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        });
        clearTimeout(timeout);
        if (!response.ok) return null;
        const html = await response.text();
        const ogMatch = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html)
          ?? /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i.exec(html)
          ?? /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i.exec(html);
        if (!ogMatch?.[1]) return null;
        const absolute = new URL(ogMatch[1], sourceUrl).href;
        return absolute;
      } catch { /* non-fatal */
        clearTimeout(timeout);
        return null;
      }
    } catch { /* non-fatal */
      return null;
    }
  }

  /** Simulate publishing (for debug/testing — no Telegram call). */
  async simulate(content: ReadyContent): Promise<{ finalPost: FinalPost; wouldPublish: boolean }> {
    const settings = await this.deps.settings();
    const minScore = settings.ai.qualityThreshold;
    // Quality gate check.
    if (content.quality.overallScore < minScore) {
      const finalPost = await this.deps.uxLayer.transform(content);
      return { finalPost, wouldPublish: false };
    }

    const finalPost = await this.deps.uxLayer.transform(content);
    return { finalPost, wouldPublish: true };
  }

  /** Strip bare URLs from text, preserving <a href="URL">text</a> links. */
  private stripBareUrls(text: string): string {
    // 1. Extract <a href="URL">text</a> tags and replace with placeholders.
    //    Use a string placeholder instead of \x00 (null byte can cause
    //    Telegram to truncate the message at that point).
    const links: string[] = [];
    let work = text.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match) => {
      links.push(match);
      return `__FREDY_LINK_${links.length - 1}__`;
    });
    // 2. Strip ALL remaining bare URLs.
    work = work.replace(/https?:\/\/[^\s<>"']+/gi, "");
    // 3. Restore <a> tags.
    work = work.replace(/__FREDY_LINK_(\d+)__/g, (_, i) => links[Number(i)] || "");
    // 4. Clean up extra whitespace (but do NOT trim — trim can remove
    //    trailing newlines that separate the source/footer blockquotes).
    return work.replace(/\n{3,}/g, "\n\n");
  }
}

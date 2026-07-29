/**
 * src/plugins/sources/nasa/index.ts
 * NASA APOD content source plugin.
 *
 * v8.1.2: Simplified — fetches ONLY today's APOD (1 item, not 3).
 * Always English. The post should be just one line of English text
 * + source + footer. No extra content needed.
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nasaManifest } from "./manifest";
export { nasaManifest } from "./manifest";

const NASA_API = "https://api.nasa.gov/planetary/apod";
// v13.4.12: Cache the RAW APOD batch (not the selected item) so the
// dedup-aware selection always runs against fresh dedup state.
const RAW_CACHE_KEY = "fredy:source:nasa:apod:raw";
const RAW_CACHE_TTL_SECONDS = 6 * 3600; // 6 hours (APOD only updates daily)
// v13.4.12: Clear old cache key (v13.4.11 and earlier) on startup.
const OLD_CACHE_KEY = "fredy:source:nasa:apod";
// v13.4.13: One-time migration flag — ensures OLD_CACHE_KEY is deleted only once.
const MIGRATION_FLAG_KEY = "fredy:source:nasa:migrated-v13.4.13";
// v13.4.12: How many days of APOD history to fetch in one batch API call.
// 14 days gives us plenty of fallback image APODs when today is a video.
const FETCH_WINDOW_DAYS = 14;

export interface NasaPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface APODResponse {
  date?: string;
  title?: string;
  explanation?: string;
  url?: string;
  hdurl?: string;
  media_type?: string;
  service_version?: string;
  copyright?: string;
}

export class NasaPlugin implements Plugin {
  readonly metadata = nasaManifest;

  constructor(private readonly deps: NasaPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "nasa" });

    // v13.4.13: One-time migration — clear old cache format (v13.4.11 and earlier).
    // Uses a flag key to ensure the delete only runs ONCE (not on every fetch).
    // Previously (v13.4.12), the delete ran on every fetch — wasteful KV writes.
    // Now: check the flag first. If not set, delete the old key + set the flag.
    // This costs 1 extra read on the first run, then 1 read on every subsequent
    // run — but the read is cheaper than a delete write, and after the first run
    // we can skip even the flag check by using the raw cache as the flag itself.
    const migrated = await this.deps.kv.get(MIGRATION_FLAG_KEY).catch(() => null);
    if (!migrated) {
      await this.deps.kv.delete(OLD_CACHE_KEY).catch(() => {});
      // Set the migration flag with a 7-day TTL (enough to cover the 6h raw cache TTL).
      await this.deps.kv.set(MIGRATION_FLAG_KEY, "1", 7 * 24 * 3600).catch(() => {});
    }

    // v13.4.12: Check raw batch cache first.
    // We cache the RAW APODResponse array (not the selected SourceItem) so
    // the dedup-aware selection always runs against fresh dedup state.
    // If we cached the selection, a published APOD would stay cached and
    // Stage 6 dedup would reject it on the next fetch.
    const cachedRaw = await this.deps.kv.getJson<readonly APODResponse[]>(RAW_CACHE_KEY).catch(() => null);
    if (cachedRaw && cachedRaw.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", { plugin: "nasa", count: cachedRaw.length });
      const selected = await this.selectBestImage(cachedRaw);
      if (selected) return [selected];
      return [];
    }

    // Cache miss — fetch from API.
    const apiKey = this.deps.env.NASA_API_KEY || "DEMO_KEY";

    // v13.4.12: Fetch the last FETCH_WINDOW_DAYS (14) days of APODs in ONE
    // batch API call using start_date + end_date. This returns an array of
    // APOD objects, which we filter to image-only and select the best
    // unpublished one.
    //
    // This solves the user's problem: "هر روز یک عکس حداقل از ناسا داشته باشیم"
    // ("every day at least one NASA image"). On video days, we walk backwards
    // through the batch to find a recent image APOD that hasn't been published
    // yet. Only 1 API call is used regardless of how many days we fetch.
    const today = new Date().toISOString().split("T")[0]!;
    const startDate = new Date(Date.now() - (FETCH_WINDOW_DAYS - 1) * 24 * 3600 * 1000)
      .toISOString().split("T")[0]!;

    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        start_date: startDate,
        end_date: today,
      });
      const apiUrl = `${NASA_API}?${params.toString()}`;

      const res = await fetch(apiUrl, {
        headers: { "User-Agent": "FredyBot/1.0 (Cloudflare Workers)" },
      });

      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", {
          plugin: "nasa", status: res.status, startDate, endDate: today,
        });
        return [];
      }

      const data = await res.json() as APODResponse[] | APODResponse;
      // API returns an array when using start_date + end_date, but handle
      // the single-object case too (defensive).
      const apods = Array.isArray(data) ? data : [data];

      if (apods.length === 0) {
        this.deps.logger.warn("source.fetch_error", {
          plugin: "nasa", reason: "empty_response",
        });
        return [];
      }

      // Cache the raw batch (saves API calls on subsequent fetches).
      await this.deps.kv.setJson(RAW_CACHE_KEY, apods, RAW_CACHE_TTL_SECONDS).catch(() => {});

      this.deps.logger.info("source.fetch_success", {
        plugin: "nasa",
        batchCount: apods.length,
        startDate,
        endDate: today,
        imageCount: apods.filter(a => a.media_type !== "video").length,
        videoCount: apods.filter(a => a.media_type === "video").length,
      });

      // Select the best image APOD (dedup-aware).
      const selected = await this.selectBestImage(apods);
      if (selected) return [selected];
      return [];
    } catch (error) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "nasa",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * v13.4.12: Select the best image APOD from a batch.
   *
   * Strategy:
   *   1. Filter to image-only APODs (skip videos per user request)
   *   2. Sort by date descending (most recent first)
   *   3. For each candidate, check the dedup KV store:
   *      - If NOT in dedup → return it (unpublished image)
   *   4. If ALL image APODs are already published → return the most recent
   *      one anyway (as a "throwback" — re-publishing is better than no post)
   *   5. If no image APODs exist in the batch → return null (no post today)
   *
   * The dedup KV key format is: fredy:dedup:canonical:nasa:YYMMDD
   * (matches the canonical ID extraction in duplicate-detector.ts)
   *
   * v13.4.13: KV EFFICIENCY ANALYSIS:
   *   - Best case (today is image, not published): 1 KV read (today's dedup check)
   *   - Video day (today is video): 1-N reads (walks back to find unpublished image)
   *     Average case: 2-3 reads (NASA videos are ~1-2/week, so today+1-2 days back)
   *   - Worst case (all 14 days published): 14 reads + return most recent anyway
   *     This is extremely rare — would require 14 consecutive image days all published
   *   - Total per NASA post: 1-14 reads, 0 writes (writes happen in FinalPublisher)
   *   - Tier V runs once/day, so max 14 reads/day for NASA — well within KV limits
   */
  private async selectBestImage(apods: readonly APODResponse[]): Promise<SourceItem | null> {
    // Filter to image-only APODs with a valid URL.
    const imageApods = apods
      .filter(a => a.media_type !== "video" && a.url && a.date)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")); // most recent first

    if (imageApods.length === 0) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "nasa",
        reason: "no_image_apods_in_batch",
        totalApods: apods.length,
        videoApods: apods.filter(a => a.media_type === "video").length,
        message: "No image APODs found in the batch — all were videos or missing URLs",
      });
      return null;
    }

    const today = new Date().toISOString().split("T")[0]!;

    // Check dedup for each candidate (most recent first).
    for (const apod of imageApods) {
      const apodDate = apod.date ?? "";
      // Canonical ID format: nasa:YYMMDD (matches duplicate-detector.ts)
      const canonicalId = `nasa:${apodDate.replace(/-/g, "").slice(2)}`;
      const dedupKey = `fredy:dedup:canonical:${canonicalId}`;
      const alreadyPublished = await this.deps.kv.get(dedupKey).catch(() => null);

      if (!alreadyPublished) {
        // Found an unpublished image APOD!
        const isToday = apodDate === today;
        if (isToday) {
          this.deps.logger.info("source.fetch_success", {
            plugin: "nasa",
            selectedDate: apodDate,
            title: apod.title,
            reason: "today_image",
            message: `Selected today's image APOD: "${apod.title ?? "unknown"}" (${apodDate})`,
          });
        } else {
          this.deps.logger.info("source.fetch_skip", {
            plugin: "nasa",
            reason: "video_day_throwback",
            todayDate: today,
            selectedDate: apodDate,
            title: apod.title,
            message: `Today is a video — using throwback image APOD from ${apodDate}: "${apod.title ?? "unknown"}"`,
          });
        }
        return this.normalize(apod);
      }
    }

    // All image APODs in the batch are already published.
    // Use the most recent one anyway (re-publish as throwback).
    // This ensures the user ALWAYS gets a NASA image every day, even if
    // it's a repeat from a few days ago.
    const fallback = imageApods[0]!;
    this.deps.logger.info("source.fetch_skip", {
      plugin: "nasa",
      reason: "all_published_throwback",
      todayDate: today,
      selectedDate: fallback.date,
      title: fallback.title,
      imageCount: imageApods.length,
      message: `All ${imageApods.length} recent image APODs already published — re-publishing most recent: ${fallback.date} ("${fallback.title ?? "unknown"}")`,
    });
    return this.normalize(fallback);
  }

  normalize(raw: unknown): SourceItem {
    const apod = raw as APODResponse;
    const mediaType = apod.media_type ?? "image";

    // v13.4.10: Build the APOD page URL from the date.
    // This is used as the `url` field (sourceUrl / footer link / dedup canonical ID).
    // Previously, for image days, `url` was set to apod.url (the raw image URL),
    // which caused multiple downstream problems:
    //   1. Footer link pointed to the raw image file, not the APOD page
    //   2. Dedup canonical ID extraction failed (no apYYMMDD pattern in image URL)
    //   3. ImageResolver fallback failed (tried to fetch og:image from binary image)
    //   4. Link preview fallback failed (image URL has no og:image meta tags)
    // Now: ALWAYS use the APOD page URL for `url`, regardless of media_type.
    const apodDate = apod.date ?? "";
    const apodPageUrl = apodDate
      ? `https://apod.nasa.gov/apod/ap${apodDate.replace(/-/g, "").slice(2)}.html`
      : "https://apod.nasa.gov/";

    // v13.4.10: For image days, prefer apod.url (standard 1024px) over hdurl.
    // The HD URL can be very large (>10MB) which Telegram rejects.
    // v13.4.11: fetch() now filters out video days entirely, so this method
    // is only called for image days. The mediaType check is kept as a safety net.
    const imageUrl = mediaType === "image" ? (apod.url ?? apod.hdurl) : undefined;

    // v8.1.2: Keep the body concise — just the explanation, trimmed.
    // The AI pipeline will still process it, but the content is simple
    // and always in English.
    const explanation = String(apod.explanation ?? "").trim();

    return {
      id: `nasa-${apodDate}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: String(apod.title ?? "NASA APOD"),
      body: explanation,
      // v13.4.10: ALWAYS use the APOD page URL as the source URL.
      // This fixes: footer link, dedup canonical ID, ImageResolver fallback,
      // and link preview fallback. The direct image URL is in `imageUrl`.
      url: apodPageUrl,
      imageUrl: imageUrl ?? undefined,
      language: "en", // v8.1.2: Always English
      publishedAt: apodDate ? Date.parse(apodDate) || undefined : undefined,
      media: (mediaType === "image" && imageUrl) ? {
        type: "image",
        url: imageUrl,
        alt: apod.title ?? "",
        source: "provider",
      } : undefined,
      metadata: {
        date: apodDate,
        copyright: apod.copyright,
        hdurl: apod.hdurl,
        serviceVersion: apod.service_version,
        mediaType,
        apodPageUrl, // v13.4.10: Carry the page URL for downstream use
      },
      displayIcon: this.metadata.displayIcon ?? "🌌",
      displaySource: this.metadata.displaySource ?? "Source",
      fetchedAt: Date.now(),
    };
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.body;
  }

  async health(): Promise<PluginStatus> {
    return {
      pluginId: this.metadata.id,
      healthy: true,
      enabled: this.metadata.enabled,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastItemCount: null,
      // v11 Phase 3: Provider Analytics
      itemsAccepted: 0,
      itemsRejected: 0,
      averageLatencyMs: null,
      consecutiveEmptyFetches: 0,
      currentBackoffMultiplier: 1,
      lastRefreshAt: null,
    };
  }
}

export function createNasaPlugin(deps: NasaPluginDeps): NasaPlugin {
  return new NasaPlugin(deps);
}

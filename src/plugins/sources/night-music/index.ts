/**
 * src/plugins/sources/night-music/index.ts
 * v13.3.0: Night Music — Jamendo API, 10-stage quality pipeline, sendAudio().
 * v13.4.14: KV efficiency fix — batch dedup checks + API param optimization.
 *
 * Zero-static-data: all tracks come from Jamendo API.
 * JAMENDO_CLIENT_ID is read from Worker Secret (never hardcoded).
 *
 * Pipeline:
 *   1. Fetch 200 tracks from Jamendo API (order=popularity_month, groupby=artist_id)
 *   2. Stage 1: Reject invalid (missing title/artist/audio)
 *   3. Stage 2: Reject non-downloadable (audiodownload_allowed=false)
 *   4. Stage 3: Reject duration outside 2-10 min
 *   5. Stage 4: Reject low-quality titles (demo, test, ASMR, etc.)
 *   6. Stage 5+6: BATCH dedup check — single KV list() for all artists + songs
 *   7. Stage 7: Prefer tracks with album_image (artwork)
 *   8. Stage 8: Weighted quality score (0-100, reject < 40)
 *   9. Stage 9: Weighted random selection among high-scoring tracks
 *   10. Stage 10: Record publication in KV (artist + song hash) — after publish
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nightMusicManifest } from "./manifest";
export { nightMusicManifest } from "./manifest";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const JAMENDO_API = "https://api.jamendo.com/v3.0/tracks/";
const FETCH_TIMEOUT_MS = 10_000;
// v13.4.14: Increased from 100 to 200 (Jamendo API max).
// More candidates = better variety + more likely to find unpublished tracks.
const FETCH_LIMIT = 200;

// v13.4.14: Short-term API response cache (1h TTL).
// Jamendo ToU §3.3 allows "short-lived operational caching" — a 1h cache
// for the track list is compliant. This prevents duplicate API calls when
// Tier V retries within the same night (up to 2 attempts in 6h window).
const API_CACHE_KEY = "fredy:source:night-music:api-response";
const API_CACHE_TTL_SECONDS = 3600; // 1 hour

const DEDUP_ARTIST_PREFIX = "fredy:music:artist:";
const DEDUP_SONG_PREFIX = "fredy:music:song:";
const ARTIST_TTL = 30 * 24 * 3600; // 30 days
const SONG_TTL = 180 * 24 * 3600; // 180 days

// Stage 4: Low-quality title patterns — v13.3.4: expanded with karaoke/live/remix/cover/instrumental
const BAD_TITLE_PATTERNS: readonly RegExp[] = [
  /demo/i, /test/i, /sample/i, /intro/i, /outro/i, /untitled/i,
  /track\s*0?\d/i, /noise/i, /asmr/i, /meditation/i, /podcast/i,
  /audiobook/i, /prom/i, /advertisement/i, /trailer/i, /preview/i,
  /unknown/i, /placeholder/i, /work\s*in\s*progress/i, /wip/i,
  /karaoke/i, /live\s*(version|at|@|concert|session|acoustic|bootleg)/i,
  /\blive\b/i, /remix/i, /sped\s*up/i, /slowed/i, /\b8d\b/i,
  /nightcore/i, /cover\s*version/i, /rehearsal/i, /acapella/i,
  /bootleg/i, /radio\s*edit/i, /extended\s*mix/i, /club\s*mix/i,
  /instrumental\s*(version|mix|edit)/i,
];

// Stage 3: Duration limits (seconds)
const MIN_DURATION_SEC = 120; // 2 min
const MAX_DURATION_SEC = 600; // 10 min (v13.3.4: was 480=8min, raised to 600=10min per spec)

// Stage 8: Quality score threshold
const MIN_QUALITY_SCORE = 40; // v13.3.2: lowered from 80 — most CC tracks don't have artwork

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface NightMusicPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface JamendoTrack {
  readonly id: string;
  readonly name: string;
  readonly artist_name: string;
  readonly album_name?: string;
  readonly album_image?: string;
  readonly audio?: string;
  readonly audiodownload?: string;
  readonly audiodownload_allowed?: boolean;
  readonly duration?: number;
  readonly release_date?: string;
  readonly musicinfo?: { tags?: readonly string[] };
}

interface JamendoResponse {
  readonly headers: { readonly status: string; readonly results_count: number; readonly error_message?: string };
  readonly results: readonly JamendoTrack[];
}

interface MusicCandidate {
  readonly track: JamendoTrack;
  readonly audioUrl: string;
  readonly score: number;
}

// ────────────────────────────────────────────────────────────
// Plugin implementation
// ────────────────────────────────────────────────────────────

export class NightMusicPlugin implements Plugin {
  readonly metadata = nightMusicManifest;

  constructor(private readonly deps: NightMusicPluginDeps) {}

  getSource(): string { return this.metadata.id; }
  getCategory(): Category { return this.metadata.category; }
  getTier(): Tier { return this.metadata.tier; }
  supportsMedia(): boolean { return this.metadata.supportsImages; }

  // ────────────────────────────────────────────────────────────
  // Stage 1: Fetch from Jamendo API
  // ────────────────────────────────────────────────────────────

  async fetch(): Promise<readonly SourceItem[]> {
    const clientId = this.deps.env.JAMENDO_CLIENT_ID;
    if (!clientId) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music",
        reason: "missing_jamendo_client_id",
        message: "[NIGHT_MUSIC] JAMENDO_CLIENT_ID not configured — skipping",
      });
      return [];
    }

    this.deps.logger.info("source.fetch_start", { plugin: "night-music" });

    let tracks: JamendoTrack[] = [];
    try {
      tracks = await this.fetchJamendoTracks(clientId);
    } catch (error) {
      // Retry once
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music",
        error: error instanceof Error ? error.message : String(error),
        message: "[NIGHT_MUSIC] RSS_FETCH failed — retrying",
      });
      try {
        tracks = await this.fetchJamendoTracks(clientId);
      } catch (retryError) {
        this.deps.logger.error("source.fetch_error", {
          plugin: "night-music",
          error: retryError instanceof Error ? retryError.message : String(retryError),
          message: "[NIGHT_MUSIC] RSS_FETCH retry failed — skipping tonight",
        });
        return [];
      }
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music",
      itemCount: tracks.length,
      message: `[NIGHT_MUSIC] RSS_ITEMS: ${tracks.length} tracks fetched`,
    });

    if (tracks.length === 0) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music",
        reason: "rss_empty",
        message: "[NIGHT_MUSIC] RSS_EMPTY — no tracks from Jamendo",
      });
      return [];
    }

    // Run 10-stage quality pipeline
    const selected = await this.selectTrack(tracks);
    if (!selected) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music",
        reason: "no_valid_track_after_pipeline",
        message: "[NIGHT_MUSIC] QUALITY_FILTER: no valid track after 10-stage pipeline — skipping tonight",
      });
      return [];
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music",
      song: selected.track.name,
      artist: selected.track.artist_name,
      score: selected.score,
      audioUrl: selected.audioUrl,
      message: `[NIGHT_MUSIC] TRACK_SELECTED: ${selected.track.name} by ${selected.track.artist_name} (score ${selected.score})`,
    });

    // Build SourceItem
    const text = this.buildMessage(selected.track.name, selected.track.artist_name);
    const songHash = this.hashSongArtist(selected.track.name, selected.track.artist_name);

    const item: SourceItem = {
      id: `night-music-${songHash}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: `${selected.track.name} — ${selected.track.artist_name}`,
      body: text,
      url: selected.track.audio ?? selected.audioUrl,
      language: "en",
      publishedAt: Date.now(),
      media: {
        type: "audio",
        url: selected.audioUrl,
        alt: selected.track.name,
      },
      metadata: {
        song: selected.track.name,
        artist: selected.track.artist_name,
        audioUrl: selected.audioUrl,
        albumImage: selected.track.album_image,
        score: selected.score,
        jamendoId: selected.track.id,
      },
      displayIcon: this.metadata.displayIcon ?? "🎵",
      displaySource: this.metadata.displaySource ?? "Night Music",
      fetchedAt: Date.now(),
    };

    return [item];
  }

  // ────────────────────────────────────────────────────────────
  // Jamendo API fetch
  // ────────────────────────────────────────────────────────────

  private async fetchJamendoTracks(clientId: string): Promise<JamendoTrack[]> {
    // v13.4.14: Check API response cache first (1h TTL, ToU compliant).
    // This prevents duplicate API calls when Tier V retries within the same night.
    const cached = await this.deps.kv.getJson<readonly JamendoTrack[]>(API_CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", {
        plugin: "night-music",
        count: cached.length,
        message: `[NIGHT_MUSIC] API_CACHE_HIT: ${cached.length} tracks from 1h cache`,
      });
      return [...cached];
    }

    // v13.4.14: Optimized API parameters:
    //   - limit=200 (was 100) — Jamendo API max, more candidates
    //   - order=popularity_month (was popularity_week) — more stable charts
    //   - groupby=artist_id — deduplicates tracks by artist (1 track per artist)
    //     This prevents the same artist from appearing 5× in results, giving us
    //     more unique artists to choose from (better variety).
    //   - include=licenses,musicinfo,stats (was just musicinfo) — CC license URL
    //     + tags + stats counters for better quality scoring
    //   - audioformat=mp32 (unchanged) — VBR good quality
    //   - audiodlformat=mp32 — explicit download format
    //   - imagesize=300 — album artwork at 300px (reasonable size)
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(FETCH_LIMIT),
      order: "popularity_month",
      include: "musicinfo,licenses",
      audioformat: "mp32",
      audiodlformat: "mp32",
      imagesize: "300",
      groupby: "artist_id",
    });
    const url = `${JAMENDO_API}?${params.toString()}`;

    this.deps.logger.info("source.fetch_start", {
      plugin: "night-music",
      stage: "RSS_FETCH",
      url: JAMENDO_API,
      message: `[NIGHT_MUSIC] RSS_FETCH: calling Jamendo API (limit=${FETCH_LIMIT}, order=popularity_month, groupby=artist_id)`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "FredyBot/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      this.deps.logger.info("source.fetch_success", {
        plugin: "night-music",
        stage: "RSS_FETCH",
        httpStatus: res.status,
        message: `[NIGHT_MUSIC] RSS_FETCH: HTTP ${res.status}`,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Jamendo API returned ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json() as JamendoResponse;

      this.deps.logger.info("source.fetch_success", {
        plugin: "night-music",
        stage: "RSS_ITEMS",
        apiStatus: data.headers.status,
        resultsCount: data.headers.results_count,
        resultsLength: data.results?.length ?? 0,
        errorMessage: data.headers.error_message,
        message: `[NIGHT_MUSIC] RSS_ITEMS: API status=${data.headers.status}, results=${data.results?.length ?? 0}, count=${data.headers.results_count}`,
      });

      if (data.headers.status !== "success") {
        throw new Error(`Jamendo API error: ${data.headers.error_message ?? "unknown"}`);
      }

      const tracks = [...(data.results ?? [])];

      // v13.4.14: Cache the API response for 1h (ToU compliant — short-lived operational cache).
      // This saves an API call when Tier V retries within the same night.
      await this.deps.kv.setJson(API_CACHE_KEY, tracks, API_CACHE_TTL_SECONDS).catch(() => {});

      // Log first track sample for debugging
      if (tracks.length > 0) {
        const sample = tracks[0]!;
        this.deps.logger.info("source.fetch_success", {
          plugin: "night-music",
          stage: "SAMPLE_TRACK",
          name: sample.name,
          artist: sample.artist_name,
          hasAudio: !!sample.audio,
          hasAudioDownload: !!sample.audiodownload,
          audiodownloadAllowed: sample.audiodownload_allowed,
          duration: sample.duration,
          hasAlbumImage: !!sample.album_image,
          message: `[NIGHT_MUSIC] SAMPLE: name="${sample.name}" artist="${sample.artist_name}" audio=${!!sample.audio} dl=${!!sample.audiodownload} dlAllowed=${sample.audiodownload_allowed} dur=${sample.duration} img=${!!sample.album_image}`,
        });
      }

      return tracks;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────
  // 10-Stage Quality Pipeline
  // ────────────────────────────────────────────────────────────

  private async selectTrack(tracks: JamendoTrack[]): Promise<MusicCandidate | null> {
    const candidates: MusicCandidate[] = [];
    let rejected = { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0, stage6: 0, stage8: 0 };

    // v13.4.14: BATCH DEDUP — fetch ALL published artist + song keys in 2 KV list() calls
    // instead of 2 separate KV reads PER TRACK (which was 200+ reads for 100 tracks).
    //
    // OLD (v13.3.4): for each of 100 tracks → 2 sequential KV reads = up to 200 reads
    // NEW (v13.4.14): 2 KV list() calls (1 for artists prefix, 1 for songs prefix)
    //                 → ~2 reads total (regardless of track count)
    //
    // KV reads reduced from ~200 to ~2 — 100× improvement!
    //
    // Note: KV list() returns up to 1000 keys per call. With 30-day artist TTL
    // (max 30 artists) and 180-day song TTL (max 180 songs), we're well within
    // the 1000-key limit.
    const publishedArtists = new Set<string>();
    const publishedSongs = new Set<string>();

    try {
      // v13.4.14: limit=200 for artists (30-day TTL, max ~30 artists, 200 is safe)
      const artistKeys = await this.deps.kv.list(DEDUP_ARTIST_PREFIX, 200);
      for (const key of artistKeys) {
        publishedArtists.add(key.slice(DEDUP_ARTIST_PREFIX.length));
      }
    } catch { /* non-fatal — treat as empty */ }

    try {
      // v13.4.14: limit=1000 for songs (180-day TTL, max ~180 songs, 1000 is KV max)
      const songKeys = await this.deps.kv.list(DEDUP_SONG_PREFIX, 1000);
      for (const key of songKeys) {
        publishedSongs.add(key.slice(DEDUP_SONG_PREFIX.length));
      }
    } catch { /* non-fatal — treat as empty */ }

    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music",
      stage: "DEDUP_BATCH_LOAD",
      publishedArtists: publishedArtists.size,
      publishedSongs: publishedSongs.size,
      message: `[NIGHT_MUSIC] DEDUP_BATCH: ${publishedArtists.size} artists + ${publishedSongs.size} songs loaded in 2 KV list() calls`,
    });

    for (const track of tracks) {
      // Stage 1: Required fields
      if (!track.name || !track.artist_name) { rejected.stage1++; continue; }
      if (!track.audio && !track.audiodownload) { rejected.stage1++; continue; }

      // Stage 2: Must be downloadable (but don't reject if field is missing — assume allowed)
      if (track.audiodownload_allowed === false) { rejected.stage2++; continue; }

      // Determine audio URL: prefer audiodownload, fallback to audio
      const audioUrl = track.audiodownload ?? track.audio;
      if (!audioUrl) { rejected.stage1++; continue; }

      // Stage 3: Duration 2-10 min
      const duration = track.duration ?? 0;
      if (duration > 0 && (duration < MIN_DURATION_SEC || duration > MAX_DURATION_SEC)) { rejected.stage3++; continue; }

      // Stage 4: Low-quality title filter
      if (BAD_TITLE_PATTERNS.some((re) => re.test(track.name))) { rejected.stage4++; continue; }

      // v13.4.14: Stage 5+6 — BATCH dedup check (in-memory Set lookup, 0 KV reads)
      // Previously: 2 sequential KV reads per track (up to 200 reads for 100 tracks)
      // Now: in-memory Set.has() — O(1) lookup, 0 KV reads
      const artistNormalized = this.normalizeStr(track.artist_name);
      if (publishedArtists.has(artistNormalized)) { rejected.stage5++; continue; }

      const songHash = this.hashSongArtist(track.name, track.artist_name);
      if (publishedSongs.has(songHash)) { rejected.stage6++; continue; }

      // Stage 7: Prefer tracks with artwork
      const hasArtwork = !!track.album_image;

      // Stage 8: Weighted quality score
      const score = this.computeScore(track, audioUrl, hasArtwork);
      if (score < MIN_QUALITY_SCORE) { rejected.stage8++; continue; }

      candidates.push({ track, audioUrl, score });
      if (candidates.length >= 20) break; // enough candidates for weighted random
    }

    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music",
      stage: "QUALITY_FILTER",
      totalTracks: tracks.length,
      candidates: candidates.length,
      rejected: rejected,
      message: `[NIGHT_MUSIC] QUALITY_FILTER: ${tracks.length} total → ${candidates.length} candidates (rejected: s1=${rejected.stage1} s2=${rejected.stage2} s3=${rejected.stage3} s4=${rejected.stage4} s5=${rejected.stage5} s6=${rejected.stage6} s8=${rejected.stage8})`,
    });

    if (candidates.length === 0) return null;

    // Stage 9: Weighted random selection
    const selected = this.weightedRandom(candidates);
    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music", stage: "AUDIO_FOUND",
      song: selected.track.name, artist: selected.track.artist_name,
      audioUrl: selected.audioUrl,
      message: `[NIGHT_MUSIC] AUDIO_FOUND: ${selected.audioUrl}`,
    });

    // v13.3.4: KV recording MOVED to FinalPublisher — only record AFTER
    // successful download + Telegram upload. Previously, KV was recorded here
    // (BEFORE publish), which meant a failed song would be marked as "used"
    // and never retried. Now, the plugin returns the selected track WITHOUT
    // recording KV. FinalPublisher calls recordPublished() after success.

    return selected;
  }

  // ────────────────────────────────────────────────────────────
  // Stage 8: Quality Score
  // ────────────────────────────────────────────────────────────

  private computeScore(track: JamendoTrack, _audioUrl: string, hasArtwork: boolean): number {
    let score = 0;

    // Downloadable: +30
    if (track.audiodownload) score += 30;
    else if (track.audiodownload_allowed !== false) score += 20;

    // Has artwork: +15
    if (hasArtwork) score += 15;

    // Duration 3-5 min: +15
    const duration = track.duration ?? 0;
    if (duration >= 180 && duration <= 300) score += 15;
    else if (duration >= 120 && duration <= 480) score += 8;

    // Recent release: +10 (within last 2 years)
    if (track.release_date) {
      const releaseYear = new Date(track.release_date).getFullYear();
      const currentYear = new Date().getFullYear();
      if (currentYear - releaseYear <= 2) score += 10;
      else if (currentYear - releaseYear <= 5) score += 5;
    }

    // Complete metadata: +10
    if (track.album_name && track.musicinfo?.tags && track.musicinfo.tags.length > 0) score += 10;

    // Remaining bonus: +10 (base for passing all stages)
    score += 10;

    return Math.min(100, score);
  }

  // ────────────────────────────────────────────────────────────
  // Stage 9: Weighted Random
  // ────────────────────────────────────────────────────────────

  private weightedRandom(candidates: MusicCandidate[]): MusicCandidate {
    const weights = candidates.map((c) => ({ candidate: c, weight: Math.max(1, c.score) }));
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;
    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) return w.candidate;
    }
    return weights[weights.length - 1]!.candidate;
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  /** v13.3.4: Record publication in KV — called by FinalPublisher AFTER successful upload. */
  async recordPublished(song: string, artist: string): Promise<void> {
    const artistKey = `${DEDUP_ARTIST_PREFIX}${this.normalizeStr(artist)}`;
    const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(song, artist)}`;
    await this.deps.kv.set(artistKey, String(Date.now()), ARTIST_TTL).catch(() => {});
    await this.deps.kv.set(songKey, String(Date.now()), SONG_TTL).catch(() => {});
  }

  private normalizeStr(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/gi, "").trim();
  }

  private hashSongArtist(song: string, artist: string): string {
    const normalized = `${this.normalizeStr(song)}|${this.normalizeStr(artist)}`;
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }
    return `m${Math.abs(hash).toString(36)}`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private buildMessage(song: string, artist: string): string {
    // v13.3.4: Footer in <blockquote> to match other Fredy posts.
    return `<code>${this.escapeHtml(song)}</code>\n<code>${this.escapeHtml(artist)}</code>\n\n<blockquote>🌀 @ILIVIR3</blockquote>`;
  }

  normalize(raw: unknown): SourceItem {
    return raw as SourceItem;
  }

  validate(item: SourceItem): boolean {
    return !!item.title && !!item.body && !!item.metadata?.audioUrl;
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
      itemsAccepted: 0,
      itemsRejected: 0,
      averageLatencyMs: null,
      consecutiveEmptyFetches: 0,
      currentBackoffMultiplier: 1,
      lastRefreshAt: null,
    };
  }
}

export function createNightMusicPlugin(deps: NightMusicPluginDeps): NightMusicPlugin {
  return new NightMusicPlugin(deps);
}

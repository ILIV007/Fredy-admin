/**
 * src/plugins/sources/night-music/index.ts
 * v13.3.0: Night Music — Jamendo API, 10-stage quality pipeline, sendAudio().
 * v13.4.14: KV efficiency fix — batch dedup checks + API param optimization.
 * v13.5.0: Artist dedup REMOVED — only song dedup (180-day) remains.
 *
 * Zero-static-data: all tracks come from Jamendo API.
 * JAMENDO_CLIENT_ID is read from Worker Secret (never hardcoded).
 *
 * Pipeline (v13.5.0 — 9 stages, artist cooldown removed):
 *   1. Fetch 200 tracks from Jamendo API (order=popularity_month, groupby=artist_id)
 *   2. Stage 1: Reject invalid (missing title/artist/audio)
 *   3. Stage 2: Reject non-downloadable (audiodownload_allowed=false)
 *   4. Stage 3: Reject duration outside 2-10 min
 *   5. Stage 4: Reject low-quality titles (demo, test, ASMR, etc.)
 *   6. Stage 6: BATCH song dedup — single KV list() for all songs (180-day)
 *      [Stage 5 (artist dedup) REMOVED in v13.5.0 — artists can repeat]
 *   7. Stage 7: Prefer tracks with album_image (artwork)
 *   8. Stage 8: Weighted quality score (0-100, reject < 40)
 *   9. Stage 9: Weighted random selection among high-scoring tracks
 *   10. Stage 10: Record publication in KV (song hash only) — after publish
 */

import type { Plugin, PluginStatus } from "../../../types/plugin";
import type { SourceItem } from "../../../types/api";
import type { Category } from "../../../types/category";
import type { Tier } from "../../../types/tier";
import type { Env } from "../../../types/env";
import type { KVStore } from "../../../services/kv-store";
import type { PluginLogger } from "../../../services/plugin-logger";
import { nightMusicManifest } from "./manifest";
import { HALL_OF_FAME } from "./hall-of-fame";
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
const MIN_QUALITY_SCORE = 20; // v14.0.5: lowered from 40 — base score is 20 (downloadable+base), so any valid track passes

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
    // v14.0.9: Clear the published songs cache at the start of each fetch()
    // so the next fetch() gets fresh data from KV.
    this._publishedSongsCache = null;

    const clientId = this.deps.env.JAMENDO_CLIENT_ID;
    if (!clientId) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music",
        reason: "missing_jamendo_client_id",
        message: "[NIGHT_MUSIC] JAMENDO_CLIENT_ID not configured — skipping",
      });
      // v14.0.7: Even without client ID, try nuclear fallback (Hall of Fame).
      // Hall of Fame doesn't need JAMENDO_CLIENT_ID — it uses a search URL.
      return await this.nuclearFallback("missing_client_id");
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
          message: "[NIGHT_MUSIC] RSS_FETCH retry failed — trying nuclear fallback",
        });
        // v14.0.7: Don't return [] — try nuclear fallback!
        return await this.nuclearFallback("api_fetch_failed");
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
        message: "[NIGHT_MUSIC] RSS_EMPTY — no tracks from Jamendo, trying nuclear fallback",
      });
      // v14.0.7: Don't return [] — try nuclear fallback!
      return await this.nuclearFallback("api_returned_empty");
    }

    // Run quality pipeline
    const selected = await this.selectTrack(tracks);
    if (!selected) {
      // v14.0.7: Nuclear fallback — selectTrack returned null.
      return await this.nuclearFallback("select_track_null");
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

  /**
   * v14.0.9: Load published songs from KV — cached for the duration of a single fetch()
   * call to avoid redundant kv.list() calls between selectTrack and selectFromHallOfFame.
   */
  private _publishedSongsCache: Set<string> | null = null;

  private async loadPublishedSongs(): Promise<Set<string>> {
    if (this._publishedSongsCache) return this._publishedSongsCache;

    const publishedSongs = new Set<string>();
    try {
      const songKeys = await this.deps.kv.list(DEDUP_SONG_PREFIX, 1000);
      for (const key of songKeys) {
        publishedSongs.add(key.slice(DEDUP_SONG_PREFIX.length));
      }
    } catch { /* non-fatal */ }

    this._publishedSongsCache = publishedSongs;
    return publishedSongs;
  }

  /**
   * v14.0.7: Nuclear fallback wrapper — called from ALL failure paths in fetch().
   * Logs the reason, then calls selectFromHallOfFame().
   * Returns [item] if successful, [] if Hall of Fame is empty (should NEVER happen).
   */
  private async nuclearFallback(reason: string): Promise<readonly SourceItem[]> {
    this.deps.logger.warn("source.fetch_error", {
      plugin: "night-music",
      reason: `nuclear_fallback_${reason}`,
      message: `[NIGHT_MUSIC] NUCLEAR_FALLBACK (${reason}): using Hall of Fame directly`,
    });

    const item = await this.selectFromHallOfFame();
    if (item) {
      this.deps.logger.info("source.fetch_success", {
        plugin: "night-music",
        stage: "NUCLEAR_FALLBACK_SUCCESS",
        song: (item.metadata as Record<string, unknown>)?.song,
        artist: (item.metadata as Record<string, unknown>)?.artist,
        message: `[NIGHT_MUSIC] NUCLEAR_FALLBACK_SUCCESS: Hall of Fame song selected`,
      });
      return [item];
    }

    this.deps.logger.error("source.fetch_error", {
      plugin: "night-music",
      reason: "nuclear_fallback_failed",
      message: "[NIGHT_MUSIC] NUCLEAR_FALLBACK FAILED — Hall of Fame is empty. This should NEVER happen.",
    });
    return [];
  }

  /**
   * v14.0.6: Nuclear fallback — select a random song from Hall of Fame.
   * v14.1.1: Must return REAL audio URL (not text-only).
   * v14.1.2: CRITICAL FIX — limit to 5 search attempts max (was looping 300+).
   * Previously, if Jamendo API was slow/down, it would try ALL 300+ Hall of Fame
   * entries with individual API calls, taking 7+ seconds and timing out.
   * Now: tries only 5 random entries. If none found, returns null.
   * 5 attempts × 10s timeout = max 50s — but Cloudflare 30s limit means
   * we'll only get ~2-3 attempts before timeout anyway.
   * With FETCH_TIMEOUT_MS = 10s, 5 attempts = max 50s, but Worker kills at 30s.
   * So in practice: ~2-3 attempts before Worker timeout. This is fine —
   * if the first 2-3 don't find anything, the API is likely down entirely.
   */
  private async selectFromHallOfFame(): Promise<SourceItem | null> {
    if (HALL_OF_FAME.length === 0) return null;

    const clientId = this.deps.env.JAMENDO_CLIENT_ID ?? "";
    if (!clientId) return null;

    const publishedSongs = await this.loadPublishedSongs();

    // v14.1.2: Shuffle and take only first 5 entries to try.
    const shuffled = [...HALL_OF_FAME].sort(() => Math.random() - 0.5);
    const maxAttempts = 5; // v14.1.2: limit API calls to prevent timeout
    const candidates = shuffled.filter(e => {
      const hash = this.hashSongArtist(e.song, e.artist);
      return !publishedSongs.has(hash);
    });
    // If no unpublished candidates, use all (reuse).
    const toTry = candidates.length > 0 ? candidates.slice(0, maxAttempts) : shuffled.slice(0, maxAttempts);

    this.deps.logger.info("source.fetch_start", {
      plugin: "night-music",
      stage: "HALL_OF_FAME_SEARCH",
      attempts: toTry.length,
      unpublishedCandidates: candidates.length,
      message: `[NIGHT_MUSIC] HALL_OF_FAME: trying ${toTry.length} entries (max ${maxAttempts})`,
    });

    for (const entry of toTry) {
      try {
        const searchUrl = `${JAMENDO_API}?client_id=${clientId}&format=json&limit=1&audioformat=mp32&name=${encodeURIComponent(entry.song)}&artist_name=${encodeURIComponent(entry.artist)}`;
        // v14.1.2: Reduced timeout to 5s (was 10s) — 5 attempts × 5s = 25s max.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(searchUrl, {
          headers: { "User-Agent": "FredyBot/1.0" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) continue;
        const data = await res.json() as JamendoResponse;
        if (data.headers.status !== "success" || !data.results || data.results.length === 0) continue;

        const track = data.results[0]!;
        const audioUrl = track.audiodownload ?? track.audio;
        if (!audioUrl) continue;

        // Found a real track with audio!
        const songHash = this.hashSongArtist(entry.song, entry.artist);
        const text = this.buildMessage(track.name ?? entry.song, track.artist_name ?? entry.artist);
        this.deps.logger.info("source.fetch_success", {
          plugin: "night-music",
          stage: "HALL_OF_FAME_FOUND",
          song: track.name,
          artist: track.artist_name,
          message: `[NIGHT_MUSIC] HALL_OF_FAME_FOUND: "${track.name}" by ${track.artist_name} — real audio URL obtained`,
        });

        return {
          id: `night-music-${songHash}`,
          source: this.metadata.id,
          category: this.metadata.category,
          title: `${track.name ?? entry.song} — ${track.artist_name ?? entry.artist}`,
          body: text,
          url: audioUrl,
          language: "en",
          publishedAt: Date.now(),
          media: {
            type: "audio",
            url: audioUrl,
            alt: track.name ?? entry.song,
          },
          metadata: {
            song: track.name ?? entry.song,
            artist: track.artist_name ?? entry.artist,
            audioUrl,
            albumImage: track.album_image,
            score: 50,
            jamendoId: track.id ?? `hof-${songHash}`,
            hallOfFame: true,
          },
          displayIcon: this.metadata.displayIcon ?? "🎵",
          displaySource: this.metadata.displaySource ?? "Night Music",
          fetchedAt: Date.now(),
        };
      } catch {
        continue; // Timeout or error — try next entry.
      }
    }

    this.deps.logger.error("source.fetch_error", {
      plugin: "night-music",
      reason: "hall_of_fame_search_failed",
      attempts: toTry.length,
      message: `[NIGHT_MUSIC] HALL_OF_FAME: all ${toTry.length} attempts failed Jamendo search`,
    });
    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Jamendo API fetch
  // ────────────────────────────────────────────────────────────

  private async fetchJamendoTracks(clientId: string): Promise<JamendoTrack[]> {
    // v13.4.14: Check API response cache first (1h TTL, ToU compliant).
    // v14.0.5: Also delete stale empty cache entries.
    const cached = await this.deps.kv.getJson<readonly JamendoTrack[]>(API_CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_cache_hit", {
        plugin: "night-music",
        count: cached.length,
        message: `[NIGHT_MUSIC] API_CACHE_HIT: ${cached.length} tracks from 1h cache`,
      });
      return [...cached];
    }
    // v14.0.5: If cache exists but is empty (stale from a failed fetch), delete it.
    if (cached && cached.length === 0) {
      await this.deps.kv.delete(API_CACHE_KEY).catch(() => {});
      this.deps.logger.info("source.fetch_skip", {
        plugin: "night-music",
        message: "[NIGHT_MUSIC] API_CACHE: deleted stale empty cache entry",
      });
    }

    // v14.0.5: REMOVED groupby=artist_id — this parameter was causing issues:
    // 1. It reduced the result set (only 1 track per artist)
    // 2. Combined with dedup (180-day), ALL tracks could be rejected
    // 3. Jamendo API behavior with groupby is unpredictable for some client_ids
    // Now: fetch ALL popular tracks (up to 200), let the pipeline filter them.
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(FETCH_LIMIT),
      order: "popularity_month",
      include: "musicinfo,licenses",
      audioformat: "mp32",
      audiodlformat: "mp32",
      imagesize: "300",
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
      // v14.0.5: Only cache if tracks.length > 0 — don't cache empty results
      // (would cause all subsequent fetches within 1h to return empty too).
      if (tracks.length > 0) {
        await this.deps.kv.setJson(API_CACHE_KEY, tracks, API_CACHE_TTL_SECONDS).catch(() => {});
      }

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
    let rejected = { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage6: 0, stage8: 0 };

    // v13.5.0: ARTIST DEDUP REMOVED per user request.
    // User: "محدودیت هنرمند نمیخواد بزاری!!خواننده جزو محدودیت ها نباشه!!"
    // ("Don't set artist limitation!! Singer should not be among limitations!!")
    //
    // Previously (v13.3.0–v13.4.14): Stage 5 rejected tracks from artists
    // published in the last 30 days (artist cooldown). This prevented the same
    // artist from appearing twice within a month — but the user wants NO artist
    // limitation. Artists can now repeat freely.
    //
    // v14.0.9: Use loadPublishedSongs() — caches the KV list() result for
    // reuse by selectFromHallOfFame() (saves 1 redundant kv.list call).
    const publishedSongs = await this.loadPublishedSongs();

    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music",
      stage: "DEDUP_BATCH_LOAD",
      publishedSongs: publishedSongs.size,
      message: `[NIGHT_MUSIC] DEDUP_BATCH: ${publishedSongs.size} songs loaded (artist dedup REMOVED v13.5.0)`,
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

      // v13.5.0: Stage 5 (artist dedup) REMOVED — artists can repeat freely.

      // v13.4.14: Stage 6 — song dedup (in-memory Set lookup, 0 KV reads)
      // Only the SAME SONG is rejected (180-day cooldown). Same artist, different song = OK.
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
      message: `[NIGHT_MUSIC] QUALITY_FILTER: ${tracks.length} total → ${candidates.length} candidates (rejected: s1=${rejected.stage1} s2=${rejected.stage2} s3=${rejected.stage3} s4=${rejected.stage4} s6=${rejected.stage6} s8=${rejected.stage8})`,
    });

    if (candidates.length === 0) {
      // v14.0.4: FALLBACK — if all tracks are rejected by dedup (Stage 6),
      // pick the FIRST valid track (passes Stage 1-4) ignoring dedup.
      // This ensures Night Music ALWAYS publishes — even if all recent
      // popular tracks were already published in the last 180 days.
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music",
        reason: "all_rejected_by_dedup_fallback",
        totalTracks: tracks.length,
        rejectedStage6: rejected.stage6,
        message: `[NIGHT_MUSIC] FALLBACK: all ${tracks.length} tracks rejected by dedup — picking first valid track ignoring dedup`,
      });

      // Find the first track that passes Stage 1-4 (skip dedup Stage 6).
      for (const track of tracks) {
        if (!track.name || !track.artist_name) continue;
        if (!track.audio && !track.audiodownload) continue;
        if (track.audiodownload_allowed === false) continue;
        const audioUrl = track.audiodownload ?? track.audio;
        if (!audioUrl) continue;
        const duration = track.duration ?? 0;
        if (duration > 0 && (duration < MIN_DURATION_SEC || duration > MAX_DURATION_SEC)) continue;
        if (BAD_TITLE_PATTERNS.some((re) => re.test(track.name))) continue;

        // Found a valid track — use it as fallback.
        const hasArtwork = !!track.album_image;
        const score = this.computeScore(track, audioUrl, hasArtwork);
        this.deps.logger.info("source.fetch_success", {
          plugin: "night-music",
          stage: "FALLBACK_TRACK",
          song: track.name,
          artist: track.artist_name,
          score,
          message: `[NIGHT_MUSIC] FALLBACK_TRACK: "${track.name}" by ${track.artist_name} (score ${score}) — selected ignoring dedup`,
        });
        return { track, audioUrl, score };
      }

      // If we STILL can't find a valid track (all fail Stage 1-4), return null.
      return null;
    }

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

    // v14.0.5: Base bonus increased to 20 (was 10) — ensures minimum score
    // is 20 (downloadable + base) which meets MIN_QUALITY_SCORE.
    // Without this, tracks without artwork/duration/metadata could score below threshold.
    score += 20;

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

  /** v13.3.4: Record publication in KV — called by FinalPublisher AFTER successful upload.
   *  v13.5.0: Artist recording REMOVED per user request (no artist limitation).
   *  Only the SONG is recorded (180-day dedup). The same artist can publish
   *  multiple songs within the 180-day window — no cooldown on artists. */
  async recordPublished(song: string, artist: string): Promise<void> {
    // v13.5.0: Artist KV recording removed — artists can repeat freely.
    // Only record the song hash (180-day dedup for the SAME song only).
    const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(song, artist)}`;
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

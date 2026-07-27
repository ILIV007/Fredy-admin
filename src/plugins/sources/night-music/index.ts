/**
 * src/plugins/sources/night-music/index.ts
 * v13.3.0: Night Music — Jamendo API, 10-stage quality pipeline, sendAudio().
 *
 * Zero-static-data: all tracks come from Jamendo API.
 * JAMENDO_CLIENT_ID is read from Worker Secret (never hardcoded).
 *
 * Pipeline:
 *   1. Fetch 50-100 tracks from Jamendo API (order=popularity_week)
 *   2. Stage 1: Reject invalid (missing title/artist/audio)
 *   3. Stage 2: Reject non-downloadable (audiodownload_allowed=false)
 *   4. Stage 3: Reject duration outside 2-8 min
 *   5. Stage 4: Reject low-quality titles (demo, test, ASMR, etc.)
 *   6. Stage 5: Reject duplicate artists (30-day KV)
 *   7. Stage 6: Reject duplicate songs (180-day KV, normalized artist+title)
 *   8. Stage 7: Prefer tracks with album_image (artwork)
 *   9. Stage 8: Weighted quality score (0-100, reject < 80)
 *   10. Stage 9: Weighted random selection among high-scoring tracks
 *   11. Stage 10: Record publication in KV (artist + song hash)
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
const FETCH_LIMIT = 100;

const DEDUP_ARTIST_PREFIX = "fredy:music:artist:";
const DEDUP_SONG_PREFIX = "fredy:music:song:";
const ARTIST_TTL = 30 * 24 * 3600; // 30 days
const SONG_TTL = 180 * 24 * 3600; // 180 days

// Stage 4: Low-quality title patterns
const BAD_TITLE_PATTERNS: readonly RegExp[] = [
  /demo/i, /test/i, /sample/i, /intro/i, /outro/i, /untitled/i,
  /track\s*0?\d/i, /noise/i, /asmr/i, /meditation/i, /podcast/i,
  /audiobook/i, /prom/i, /advertisement/i, /trailer/i, /preview/i,
  /unknown/i, /placeholder/i, /work\s*in\s*progress/i, /wip/i,
];

// Stage 3: Duration limits (seconds)
const MIN_DURATION_SEC = 120; // 2 min
const MAX_DURATION_SEC = 480; // 8 min

// Stage 8: Quality score threshold
const MIN_QUALITY_SCORE = 80;

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
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(FETCH_LIMIT),
      order: "popularity_week",
      include: "musicinfo",
      audioformat: "mp32",
    });
    const url = `${JAMENDO_API}?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "FredyBot/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`Jamendo API returned ${res.status}`);
      }
      const data = await res.json() as JamendoResponse;
      if (data.headers.status !== "success") {
        throw new Error(`Jamendo API error: ${data.headers.error_message ?? "unknown"}`);
      }
      return [...data.results];
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

    for (const track of tracks) {
      // Stage 1: Required fields
      if (!track.name || !track.artist_name || (!track.audio && !track.audiodownload)) continue;

      // Stage 2: Must be downloadable
      if (track.audiodownload_allowed === false) continue;

      // Determine audio URL: prefer audiodownload, fallback to audio
      const audioUrl = track.audiodownload ?? track.audio;
      if (!audioUrl) continue;

      // Stage 3: Duration 2-8 min
      const duration = track.duration ?? 0;
      if (duration < MIN_DURATION_SEC || duration > MAX_DURATION_SEC) continue;

      // Stage 4: Low-quality title filter
      if (BAD_TITLE_PATTERNS.some((re) => re.test(track.name))) continue;

      // Stage 5: Duplicate artist (30-day KV)
      const artistKey = `${DEDUP_ARTIST_PREFIX}${this.normalizeStr(track.artist_name)}`;
      const artistRecent = await this.deps.kv.get(artistKey).catch(() => null);
      if (artistRecent) {
        this.deps.logger.debug("source.fetch_success", {
          plugin: "night-music", stage: "DEDUP_SKIP",
          artist: track.artist_name, reason: "artist_recently_published",
        });
        continue;
      }

      // Stage 6: Duplicate song (180-day KV, normalized artist+title)
      const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(track.name, track.artist_name)}`;
      const songRecent = await this.deps.kv.get(songKey).catch(() => null);
      if (songRecent) {
        this.deps.logger.debug("source.fetch_success", {
          plugin: "night-music", stage: "DEDUP_SKIP",
          song: track.name, reason: "song_recently_published",
        });
        continue;
      }

      // Stage 7: Prefer tracks with artwork
      const hasArtwork = !!track.album_image;

      // Stage 8: Weighted quality score
      const score = this.computeScore(track, audioUrl, hasArtwork);
      if (score < MIN_QUALITY_SCORE) continue;

      candidates.push({ track, audioUrl, score });
      if (candidates.length >= 20) break; // enough candidates for weighted random
    }

    if (candidates.length === 0) return null;

    // Stage 9: Weighted random selection
    const selected = this.weightedRandom(candidates);
    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music", stage: "AUDIO_FOUND",
      song: selected.track.name, artist: selected.track.artist_name,
      audioUrl: selected.audioUrl,
      message: `[NIGHT_MUSIC] AUDIO_FOUND: ${selected.audioUrl}`,
    });

    // Stage 10: Record publication in KV
    const artistKey = `${DEDUP_ARTIST_PREFIX}${this.normalizeStr(selected.track.artist_name)}`;
    const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(selected.track.name, selected.track.artist_name)}`;
    await this.deps.kv.set(artistKey, String(Date.now()), ARTIST_TTL).catch(() => {});
    await this.deps.kv.set(songKey, String(Date.now()), SONG_TTL).catch(() => {});

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
    return `<code>${this.escapeHtml(song)}</code>\n<code>${this.escapeHtml(artist)}</code>\n\n🌀 @ILIVIR3`;
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

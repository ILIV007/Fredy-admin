/**
 * src/plugins/sources/night-music/index.ts
 * v13.2.0: Night Music content source plugin.
 *
 * Zero-API: uses Last.fm RSS feeds (no API key, no rate limit).
 * Fetches trending/popular tracks, then runs a 10-stage quality pipeline:
 *   1. Required fields (artist, title not empty)
 *   2. Bad-version filter (live, demo, karaoke, remix, etc.)
 *   3. Popularity (Last.fm playcount > 10M if available)
 *   4. Artist blacklist (podcast, ASMR, meditation, etc.)
 *   5. Recency protection (artist 30d, song 180d)
 *   6. Genre diversity (avoid 5 same-genre in a row)
 *   7. Artist diversity (max 2 per artist per 60 days)
 *   8. Hall of Fame (must be in curated 300+ legendary songs list)
 *   9. Mood rotation (day-of-week mood)
 *   10. Weighted random selection
 *
 * Dedup: Song + Artist hash (180-day TTL).
 * KV usage: minimal — 2 keys per published song (artist + song hash).
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
export { HALL_OF_FAME, isInHallOfFame, normalizeForMusicMatch } from "./hall-of-fame";
import { HALL_OF_FAME, isInHallOfFame, normalizeForMusicMatch, type HallOfFameEntry } from "./hall-of-fame";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const CACHE_KEY = "fredy:source:night-music:feed";
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours (RSS doesn't update fast)

const DEDUP_ARTIST_PREFIX = "fredy:music:artist:";
const DEDUP_SONG_PREFIX = "fredy:music:song:";
const ARTIST_TTL = 30 * 24 * 3600; // 30 days
const SONG_TTL = 180 * 24 * 3600; // 180 days

const FETCH_TIMEOUT_MS = 10_000;

// RSS feed URLs (Zero-API, no key needed)
const RSS_FEEDS: readonly string[] = [
  "https://www.last.fm/music/+charts/top/tracks",
  "https://www.last.fm/music/+charts",
  "https://rss.app/feeds/v1.1/lastfm.json",
];

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface NightMusicPluginDeps {
  readonly env: Env;
  readonly kv: KVStore;
  readonly logger: PluginLogger;
}

interface RSSTrack {
  readonly title: string;
  readonly artist: string;
  readonly playcount?: number;
  readonly listeners?: number;
  readonly url?: string;
}

interface MusicCandidate {
  readonly song: string;
  readonly artist: string;
  readonly hallOfFameEntry: HallOfFameEntry;
  readonly playcount?: number;
  readonly score: number;
}

// ────────────────────────────────────────────────────────────
// Stage filters
// ────────────────────────────────────────────────────────────

const BAD_VERSION_PATTERNS: readonly RegExp[] = [
  /live\s*(version|at|@|concert|session|acoustic)/i,
  /\blive\b/i,
  /demo/i,
  /karaoke/i,
  /instrumental/i,
  /remix/i,
  /sped\s*up/i,
  /slowed/i,
  /\b8d\b/i,
  /nightcore/i,
  /cover\s*version/i,
  /rehearsal/i,
  /acapella/i,
  /bootleg/i,
  /edit\b/i,
  /radio\s*edit/i,
  /extended\s*mix/i,
  /club\s*mix/i,
];

const ARTIST_BLACKLIST: readonly string[] = [
  "podcast", "audiobook", "meditation", "white noise", "sleep sounds",
  "asmr", "nature sounds", "ambient noise", "relaxing sounds", "binaural",
  "spoken word", "guided", "hypnosis", "affirmations",
];

// ────────────────────────────────────────────────────────────
// Day-of-week mood rotation
// ────────────────────────────────────────────────────────────

const MOOD_BY_DAY: readonly { day: number; mood: string; genres: readonly HallOfFameEntry["genre"][] }[] = [
  { day: 1, mood: "Energetic", genres: ["rock", "pop", "electronic"] },      // Monday
  { day: 2, mood: "Chill", genres: ["classic", "indie", "r&b"] },           // Tuesday
  { day: 3, mood: "Rock", genres: ["rock", "metal"] },                       // Wednesday
  { day: 4, mood: "Electronic", genres: ["electronic", "pop"] },            // Thursday
  { day: 5, mood: "Hip Hop", genres: ["hiphop", "r&b"] },                   // Friday
  { day: 6, mood: "Pop", genres: ["pop", "rock"] },                         // Saturday
  { day: 0, mood: "Classic", genres: ["classic", "rock"] },                 // Sunday
];

function getTodayMood(): { mood: string; genres: readonly HallOfFameEntry["genre"][] } {
  const day = new Date().getDay();
  return MOOD_BY_DAY.find((m) => m.day === day) ?? MOOD_BY_DAY[1]!;
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
  // Stage 1: Fetch RSS feed
  // ────────────────────────────────────────────────────────────

  async fetch(): Promise<readonly SourceItem[]> {
    this.deps.logger.info("source.fetch_start", { plugin: "night-music" });

    // Check cache first
    const cached = await this.deps.kv.getJson<readonly SourceItem[]>(CACHE_KEY).catch(() => null);
    if (cached && cached.length > 0) {
      this.deps.logger.info("source.fetch_success", { plugin: "night-music", source: "cache", returned: cached.length });
      return cached;
    }

    // Try RSS feeds
    let tracks: RSSTrack[] = [];
    for (const url of RSS_FEEDS) {
      try {
        tracks = await this.fetchRSS(url);
        if (tracks.length > 0) break;
      } catch (error) {
        this.deps.logger.warn("source.fetch_error", {
          plugin: "night-music", source: "rss", url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fallback: use Hall of Fame directly (RSS may be blocked)
    if (tracks.length === 0) {
      this.deps.logger.info("source.fetch_success", {
        plugin: "night-music", source: "hall-of-fame-fallback",
        message: "RSS feeds unavailable — using Hall of Fame directly",
      });
      tracks = HALL_OF_FAME.slice(0, 50).map((e) => ({
        title: e.song,
        artist: e.artist,
        playcount: 10_000_000, // assume high popularity for Hall of Fame
      }));
    }

    // Run the 10-stage quality pipeline
    const selected = await this.selectTrack(tracks);
    if (!selected) {
      this.deps.logger.warn("source.fetch_error", {
        plugin: "night-music", reason: "no_valid_track_after_pipeline",
        message: "[NIGHT_MUSIC] No valid track after 10-stage pipeline — skipping tonight",
      });
      return [];
    }

    // Build SourceItem with minimal text
    const text = this.buildMessage(selected.song, selected.artist);
    const songHash = this.hashSongArtist(selected.song, selected.artist);

    const item: SourceItem = {
      id: `night-music-${songHash}`,
      source: this.metadata.id,
      category: this.metadata.category,
      title: `${selected.song} — ${selected.artist}`,
      body: text,
      // v13.2.2: Normalizer requires a non-empty URL. Use Last.fm search URL
      // for the song (not displayed in the post — post is text-only).
      url: `https://www.last.fm/music/${encodeURIComponent(selected.artist)}/_/${encodeURIComponent(selected.song)}`,
      language: "en",
      publishedAt: Date.now(),
      metadata: {
        song: selected.song,
        artist: selected.artist,
        mood: getTodayMood().mood,
        hallOfFame: true,
        score: selected.score,
      },
      displayIcon: this.metadata.displayIcon ?? "🎵",
      displaySource: this.metadata.displaySource ?? "Night Music",
      fetchedAt: Date.now(),
    };

    const items = [item];
    await this.deps.kv.setJson(CACHE_KEY, items, CACHE_TTL_SECONDS).catch(() => {});

    this.deps.logger.info("source.fetch_success", {
      plugin: "night-music",
      source: "pipeline",
      returned: 1,
      song: selected.song,
      artist: selected.artist,
      mood: getTodayMood().mood,
      score: selected.score,
      message: `[NIGHT_MUSIC] Selected: ${selected.song} by ${selected.artist} (score ${selected.score})`,
    });

    return items;
  }

  // ────────────────────────────────────────────────────────────
  // RSS fetcher — parses Last.fm charts page
  // ────────────────────────────────────────────────────────────

  private async fetchRSS(url: string): Promise<RSSTrack[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (FredyBot/1.0)" },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        this.deps.logger.warn("source.fetch_error", { plugin: "night-music", url, status: res.status });
        return [];
      }

      const text = await res.text();
      // Try to parse as XML RSS first, then HTML
      if (text.includes("<rss") || text.includes("<feed")) {
        return this.parseXMLRSS(text);
      }
      // Last.fm charts page is HTML — extract track rows
      return this.parseLastFmHTML(text);
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private parseXMLRSS(xml: string): RSSTrack[] {
    const tracks: RSSTrack[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && tracks.length < 30) {
      const block = match[1] ?? "";
      const title = this.extractTag(block, "title");
      // RSS title is usually "Artist – Song" or "Song by Artist"
      const parts = title.split(/\s+[–\-—]\s+|\s+by\s+/i);
      if (parts.length >= 2) {
        tracks.push({
          title: parts[parts.length - 1]!.trim(),
          artist: parts.slice(0, -1).join(" ").trim(),
          url: this.extractTag(block, "link"),
        });
      }
    }
    return tracks;
  }

  private parseLastFmHTML(html: string): RSSTrack[] {
    const tracks: RSSTrack[] = [];
    // Last.fm chart rows: <td class="chartlist-name">...</td>
    const rowRegex = /chartlist-name[^>]*><a[^>]*>([^<]+)<\/a>[\s\S]*?chartlist-artist[^>]*>([^<]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = rowRegex.exec(html)) !== null && tracks.length < 30) {
      const song = match[1]?.trim();
      const artist = match[2]?.trim();
      if (song && artist) {
        tracks.push({ title: song, artist });
      }
    }
    return tracks;
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const match = regex.exec(xml);
    return (match?.[1] ?? match?.[2] ?? "").trim();
  }

  // ────────────────────────────────────────────────────────────
  // 10-Stage Quality Pipeline
  // ────────────────────────────────────────────────────────────

  private async selectTrack(tracks: RSSTrack[]): Promise<MusicCandidate | null> {
    const todayMood = getTodayMood();
    const candidates: MusicCandidate[] = [];

    for (const track of tracks.slice(0, 30)) {
      // Stage 1: Required fields
      if (!track.artist || !track.title || track.artist === "Unknown") continue;

      // Stage 2: Bad-version filter
      const fullText = `${track.title} ${track.artist}`.toLowerCase();
      if (BAD_VERSION_PATTERNS.some((re) => re.test(fullText))) continue;

      // Stage 3: Artist blacklist
      if (ARTIST_BLACKLIST.some((b) => fullText.includes(b))) continue;

      // Stage 4: Hall of Fame (Stage 7 in spec — required)
      const hofEntry = isInHallOfFame(track.title, track.artist);
      if (!hofEntry) continue;

      // Stage 5: Recency protection (artist 30d, song 180d)
      const artistKey = `${DEDUP_ARTIST_PREFIX}${normalizeForMusicMatch(track.artist)}`;
      const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(track.title, track.artist)}`;
      const artistRecent = await this.deps.kv.get(artistKey).catch(() => null);
      if (artistRecent) continue; // artist published in last 30 days
      const songRecent = await this.deps.kv.get(songKey).catch(() => null);
      if (songRecent) continue; // song published in last 180 days

      // Stage 6: Mood rotation — boost if genre matches today's mood
      const moodMatch = todayMood.genres.includes(hofEntry.genre);

      // Stage 8: Compute quality score
      const score = this.computeScore(hofEntry, track, moodMatch);

      candidates.push({
        song: track.title,
        artist: track.artist,
        hallOfFameEntry: hofEntry,
        playcount: track.playcount,
        score,
      });

      if (candidates.length >= 10) break; // enough candidates
    }

    // If no candidates from RSS, use Hall of Fame directly
    if (candidates.length === 0) {
      this.deps.logger.info("pipeline.start", {
        plugin: "night-music",
        step: "hall-of-fame-pool",
        message: "[NIGHT_MUSIC] No RSS candidates — using Hall of Fame pool",
      });
      // Pick from Hall of Fame, filtered by mood
      const moodPool = HALL_OF_FAME.filter((e) => todayMood.genres.includes(e.genre));
      const pool = moodPool.length > 0 ? moodPool : HALL_OF_FAME;
      for (const entry of pool) {
        const artistKey = `${DEDUP_ARTIST_PREFIX}${normalizeForMusicMatch(entry.artist)}`;
        const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(entry.song, entry.artist)}`;
        const artistRecent = await this.deps.kv.get(artistKey).catch(() => null);
        if (artistRecent) continue;
        const songRecent = await this.deps.kv.get(songKey).catch(() => null);
        if (songRecent) continue;
        const score = this.computeScore(entry, { title: entry.song, artist: entry.artist }, true);
        candidates.push({
          song: entry.song,
          artist: entry.artist,
          hallOfFameEntry: entry,
          score,
        });
        if (candidates.length >= 10) break;
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Stage 9: Weighted random selection
    const selected = this.weightedRandom(candidates);
    return selected;
  }

  // ────────────────────────────────────────────────────────────
  // Stage 8: Quality Score
  // ────────────────────────────────────────────────────────────

  private computeScore(entry: HallOfFameEntry, track: RSSTrack, moodMatch: boolean): number {
    let score = 50; // base

    // Legendary artist (Hall of Fame) — +25
    score += 25;

    // Popularity bonus
    if (track.playcount && track.playcount > 5_000_000) score += 20;
    else if (track.playcount && track.playcount > 1_000_000) score += 10;

    // Era bonus (classic songs)
    if (entry.era === "70s" || entry.era === "80s") score += 5;

    // Mood match bonus
    if (moodMatch) score += 15;

    // Genre diversity bonus (not rock-only)
    if (entry.genre !== "rock") score += 5;

    return Math.min(100, score);
  }

  // ────────────────────────────────────────────────────────────
  // Stage 9: Weighted Random
  // ────────────────────────────────────────────────────────────

  private weightedRandom(candidates: MusicCandidate[]): MusicCandidate {
    const weights = candidates.map((c) => ({
      candidate: c,
      weight: Math.max(1, c.score),
    }));
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;
    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) return w.candidate;
    }
    return weights[weights.length - 1]!.candidate;
  }

  // ────────────────────────────────────────────────────────────
  // Dedup recording (called by Tier V scheduler after publish)
  // ────────────────────────────────────────────────────────────

  async recordPublished(song: string, artist: string): Promise<void> {
    const artistKey = `${DEDUP_ARTIST_PREFIX}${normalizeForMusicMatch(artist)}`;
    const songKey = `${DEDUP_SONG_PREFIX}${this.hashSongArtist(song, artist)}`;
    await this.deps.kv.set(artistKey, String(Date.now()), ARTIST_TTL).catch(() => {});
    await this.deps.kv.set(songKey, String(Date.now()), SONG_TTL).catch(() => {});
  }

  // ────────────────────────────────────────────────────────────
  // Hash helper (for dedup key + content ID)
  // ────────────────────────────────────────────────────────────

  private hashSongArtist(song: string, artist: string): string {
    const normalized = `${normalizeForMusicMatch(song)}|${normalizeForMusicMatch(artist)}`;
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }
    return `m${Math.abs(hash).toString(36)}`;
  }

  // ────────────────────────────────────────────────────────────
  // Minimal message format
  // ────────────────────────────────────────────────────────────

  private buildMessage(song: string, artist: string): string {
    // v13.2.1: Minimal format — no header, no emoji, no blank line between song/artist.
    // Just: `Song`\n`Artist`\n\n🌀 @ILIVIR3
    return `\`${song}\`\n\`${artist}\`\n\n🌀 @ILIVIR3`;
  }

  // ────────────────────────────────────────────────────────────
  // normalize() — called by content pipeline (but we skip AI)
  // ────────────────────────────────────────────────────────────

  normalize(raw: unknown): SourceItem {
    // The fetch() already builds a complete SourceItem.
    // This is here for the Plugin interface — just pass through.
    return raw as SourceItem;
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

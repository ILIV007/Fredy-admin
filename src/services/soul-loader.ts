/**
 * src/services/soul-loader.ts
 * Loads and parses soul.md. The bundled docs/soul.md is the default;
 * KV override (fredy:soul) takes precedence when set via the admin panel.
 * See ARCHITECTURE_RULES.md §21.1 (no dead knowledge base — soul.md is sent to AI).
 */

import { soulKey } from "../core/storage/keys";
import type { Soul } from "../types/ai";
import type { KVStore } from "./kv-store";

export interface SoulLoaderDeps {
  readonly kv: KVStore;
  /** Bundled default soul.md content (imported as a raw string at build time). */
  readonly defaultSoul: string;
}

export class SoulLoader {
  private cached: Soul | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(private readonly deps: SoulLoaderDeps) {}

  /** Load the current soul. KV override if present, else bundled default. */
  async load(): Promise<Soul> {
    // Cache hit — return cached if fresh.
    if (this.cached && Date.now() - this.cachedAt < SoulLoader.CACHE_TTL_MS) {
      return this.cached;
    }

    const override = await this.deps.kv.get(soulKey());
    const raw = override ?? this.deps.defaultSoul;
    const soul = this.parse(raw);
    this.cached = soul;
    this.cachedAt = Date.now();
    return soul;
  }

  /** Save a new soul to KV (overrides the bundled default). */
  async save(raw: string): Promise<void> {
    await this.deps.kv.set(soulKey(), raw);
    this.cached = this.parse(raw);
    this.cachedAt = Date.now();
  }

  /** Reset to the bundled default by deleting the KV override. */
  async reset(): Promise<void> {
    await this.deps.kv.delete(soulKey());
    this.cached = this.parse(this.deps.defaultSoul);
    this.cachedAt = Date.now();
  }

  /** Parse a raw soul.md string into sections (separated by `# Heading`). */
  private parse(raw: string): Soul {
    const sections: Record<string, string> = {};
    const parts = raw.split(/^# (.+)$/m);
    // parts[0] is the preamble (before the first # heading); parts[1], parts[2], ... are heading/content pairs.
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i += 2) {
        const heading = (parts[i] ?? "").trim();
        const content = (parts[i + 1] ?? "").trim();
        sections[heading] = content;
      }
    }
    return { raw, sections };
  }
}

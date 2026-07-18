/**
 * src/services/soul-loader.ts
 * Loads and parses soul.md. The bundled docs/soul.md is the default;
 * KV override (fredy:soul) takes precedence when set via the admin panel.
 *
 * v8.7.0: Module-level cache singleton — persists across buildContainer()
 * calls within the same Worker isolate, matching ConfigCache's pattern.
 */

import { soulKey } from "../core/storage/keys";
import type { Soul } from "../types/ai";
import type { KVStore } from "./kv-store";

export interface SoulLoaderDeps {
  readonly kv: KVStore;
  readonly defaultSoul: string;
}

const SOUL_CACHE_TTL_MS = 60_000; // 1 minute

/** v8.7.0: Module-level cache — survives across buildContainer() calls. */
let _cachedSoul: Soul | null = null;
let _cachedSoulAt = 0;
let _soulKv: KVStore | null = null;
let _soulDefault: string = "";

function setSoulDeps(kv: KVStore, defaultSoul: string): void {
  _soulKv = kv;
  _soulDefault = defaultSoul;
}

export class SoulLoader {
  constructor(private readonly deps: SoulLoaderDeps) {
    // v8.7.0: Register deps for module-level cache.
    setSoulDeps(deps.kv, deps.defaultSoul);
  }

  async load(): Promise<Soul> {
    // v8.7.0: Use module-level cache.
    if (_cachedSoul && Date.now() - _cachedSoulAt < SOUL_CACHE_TTL_MS) {
      return _cachedSoul;
    }

    const kv = _soulKv ?? this.deps.kv;
    const defaultSoul = _soulDefault || this.deps.defaultSoul;

    const override = await kv.get(soulKey());
    const raw = override ?? defaultSoul;
    const soul = parseSoul(raw);
    _cachedSoul = soul;
    _cachedSoulAt = Date.now();
    return soul;
  }

  async save(raw: string): Promise<void> {
    const kv = _soulKv ?? this.deps.kv;
    await kv.set(soulKey(), raw);
    _cachedSoul = parseSoul(raw);
    _cachedSoulAt = Date.now();
  }

  async reset(): Promise<void> {
    const kv = _soulKv ?? this.deps.kv;
    const defaultSoul = _soulDefault || this.deps.defaultSoul;
    await kv.delete(soulKey());
    _cachedSoul = parseSoul(defaultSoul);
    _cachedSoulAt = Date.now();
  }
}

/** Parse a raw soul.md string into sections. */
function parseSoul(raw: string): Soul {
  const sections: Record<string, string> = {};
  const parts = raw.split(/^# (.+)$/m);
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) {
      const heading = (parts[i] ?? "").trim();
      const content = (parts[i + 1] ?? "").trim();
      sections[heading] = content;
    }
  }
  return { raw, sections };
}

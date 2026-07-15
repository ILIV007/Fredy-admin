/**
 * src/services/config-service.ts
 * Public configuration API. Ties together the section registry, repository,
 * and cache.
 *
 * This is the ONLY service other modules call to read/write config:
 *   const settings = await container.config.getSettings(adminId);
 *   await container.config.updateSettings(adminId, { ai: { temperature: 0.5 } });
 *
 * See ARCHITECTURE_RULES.md §8.
 */

import { ConfigSectionRegistry } from "../core/config/section-registry";
import { registerAllSections } from "../core/config/sections";
import { ConfigValidationError } from "../core/errors";
import type {
  ConfigExportResult,
  ConfigImportResult,
  ConfigUpdateResult,
  ConfigValidationResult,
  FredySettings,
  FredyState,
  SettingsPatch,
} from "../types/config";
import type { Env } from "../types/env";
import type { ConfigCache } from "./config-cache";
import type { ConfigRepository } from "./config-repository";
import type { KVStore } from "./kv-store";

export interface ConfigServiceDeps {
  readonly kv: KVStore;
  readonly env: Env;
  readonly repository: ConfigRepository;
  readonly cache: ConfigCache;
  readonly registry: ConfigSectionRegistry;
}

/** Default state — applied when no state blob exists yet. */
export function defaultState(): FredyState {
  return {
    stats: { processed: 0, published: 0, rejected: 0, failed: 0 },
    lastPublishedAt: null,
    lastSource: null,
    lastCategory: null,
    lastSourceEmojis: [],
    today: {
      date: new Date().toISOString().slice(0, 10),
      slotsFired: [],
      categoriesPublished: { A: 0, B: 0, C: 0 },
    },
  };
}

export class ConfigService {
  constructor(private readonly deps: ConfigServiceDeps) {}

  // ────────────────────────────────────────────────────────────
  // Read
  // ────────────────────────────────────────────────────────────

  /** Load settings for an admin, with caching, migration, and defaults. */
  async getSettings(adminId: string | number): Promise<FredySettings> {
    const key = String(adminId);

    // Check cache first.
    const cached = this.deps.cache.get(key);
    if (cached) return cached;

    // Load from KV.
    const raw = await this.deps.repository.load(key);
    let settings: FredySettings;

    if (raw === null) {
      // No stored settings — use defaults.
      settings = this.buildDefaults();
    } else {
      // Migrate to current schema versions, then validate.
      const migrated = this.deps.registry.migrateAll(raw);
      const validated = this.deps.registry.validateAll(migrated);
      if (!validated.ok) {
        // Validation failed — fall back to defaults merged with valid sections.
        console.warn("[config] validation failed, using defaults for invalid sections:", validated.errors);
        settings = this.mergeWithDefaults(migrated);
      } else {
        settings = validated.data as FredySettings;
      }
    }

    this.deps.cache.set(key, settings);
    return settings;
  }

  /** Load state for an admin. State is separate from settings (§8.4).
   *  Cached in-memory for 10 seconds to reduce KV reads — state is read
   *  frequently by emoji rotator, source formatter, and category manager
   *  on every publish, and 10s staleness is acceptable. */
  async getState(adminId: string | number): Promise<FredyState> {
    const key = String(adminId);
    const cached = this.stateCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    const state = await this.deps.kv.getJson<FredyState>(`fredy:state:${adminId}`);
    const result = state ?? defaultState();
    this.stateCache.set(key, { value: result, expiresAt: Date.now() + 10_000 });
    return result;
  }

  /** State cache (per-isolate, 10s TTL). */
  private readonly stateCache = new Map<string, { value: FredyState; expiresAt: number }>();

  /** Get a single section by key. */
  async getSection<T>(adminId: string | number, sectionKey: string): Promise<T | null> {
    const settings = await this.getSettings(adminId);
    return (settings as unknown as Record<string, T>)[sectionKey] ?? null;
  }

  // ────────────────────────────────────────────────────────────
  // Write
  // ────────────────────────────────────────────────────────────

  /** Update settings with a deep-merged patch. Validates before writing. */
  async updateSettings(
    adminId: string | number,
    patch: SettingsPatch,
  ): Promise<ConfigUpdateResult> {
    const key = String(adminId);
    const current = await this.getSettings(key);
    const merged = this.deepMerge(current as Record<string, unknown>, patch as Record<string, unknown>);
    const validated = this.deps.registry.validateAll(merged);

    if (!validated.ok) {
      return {
        ok: false,
        settings: current,
        error: JSON.stringify(validated.errors),
      };
    }

    await this.deps.repository.save(key, validated.data);
    const settings = validated.data as FredySettings;
    this.deps.cache.set(key, settings);
    return { ok: true, settings };
  }

  /** Update a single section. */
  async updateSection<T>(
    adminId: string | number,
    sectionKey: string,
    value: T,
  ): Promise<ConfigUpdateResult> {
    return this.updateSettings(adminId, {
      [sectionKey]: value,
    } as unknown as SettingsPatch);
  }

  /** Reset settings to defaults. */
  async resetSettings(adminId: string | number): Promise<FredySettings> {
    const key = String(adminId);
    const defaults = this.buildDefaults();
    await this.deps.repository.save(key, defaults);
    this.deps.cache.set(key, defaults);
    return defaults;
  }

  /** Reset a single section to defaults. */
  async resetSection(adminId: string | number, sectionKey: string): Promise<ConfigUpdateResult> {
    const key = String(adminId);
    const section = this.deps.registry.get(sectionKey);
    if (!section) {
      return {
        ok: false,
        settings: await this.getSettings(key),
        error: `Section "${sectionKey}" not registered`,
      };
    }
    return this.updateSettings(adminId, {
      [sectionKey]: section.defaults,
    } as unknown as SettingsPatch);
  }

  // ────────────────────────────────────────────────────────────
  // State (separate from settings)
  // ────────────────────────────────────────────────────────────

  /** Update state. State is not validated (it's runtime, not config). */
  async updateState(
    adminId: string | number,
    updater: (current: FredyState) => FredyState,
  ): Promise<FredyState> {
    const key = String(adminId);
    const current = await this.getState(key);
    const next = updater(current);
    await this.deps.kv.setJson(`fredy:state:${key}`, next);
    // Invalidate state cache so the next read picks up the new value.
    this.stateCache.delete(key);
    return next;
  }

  /** Reset state to defaults. */
  async resetState(adminId: string | number): Promise<FredyState> {
    const key = String(adminId);
    const defaults = defaultState();
    await this.deps.kv.setJson(`fredy:state:${key}`, defaults);
    this.stateCache.delete(key);
    return defaults;
  }

  // ────────────────────────────────────────────────────────────
  // Validate
  // ────────────────────────────────────────────────────────────

  /** Validate an arbitrary settings blob without saving. */
  async validateSettings(input: unknown): Promise<ConfigValidationResult> {
    const validated = this.deps.registry.validateAll(input as Record<string, unknown>);
    return validated.ok
      ? { ok: true, errors: {} }
      : { ok: false, errors: validated.errors };
  }

  /** Validate a single section. */
  async validateSection(sectionKey: string, input: unknown): Promise<ConfigValidationResult> {
    const result = this.deps.registry.validateSection(sectionKey, input);
    return result.ok
      ? { ok: true, errors: {} }
      : { ok: false, errors: { [sectionKey]: result.error } };
  }

  // ────────────────────────────────────────────────────────────
  // Export / Import
  // ────────────────────────────────────────────────────────────

  /** Export settings as a JSON string (for download/backup/sharing). */
  async exportSettings(adminId: string | number): Promise<ConfigExportResult> {
    const key = String(adminId);
    const json = await this.deps.repository.export(key);
    return {
      ok: true,
      json,
      version: "0.4.0",
      exportedAt: new Date().toISOString(),
    };
  }

  /** Import settings from a JSON string. Validates before saving. */
  async importSettings(
    adminId: string | number,
    json: string,
  ): Promise<ConfigImportResult> {
    const key = String(adminId);
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const validated = this.deps.registry.validateAll(parsed);
      if (!validated.ok) {
        return {
          ok: false,
          settings: null,
          error: JSON.stringify(validated.errors),
        };
      }
      await this.deps.repository.save(key, validated.data);
      const settings = validated.data as FredySettings;
      this.deps.cache.set(key, settings);
      return { ok: true, settings };
    } catch (error) {
      return {
        ok: false,
        settings: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // Introspection
  // ────────────────────────────────────────────────────────────

  /** List all registered section keys with their descriptions. */
  listSections(): ReadonlyArray<{ readonly key: string; readonly description: string; readonly version: number }> {
    return this.deps.registry.list().map((s) => ({
      key: s.key,
      description: s.description,
      version: s.version,
    }));
  }

  /** Get cache stats for the debug dashboard. */
  cacheStats(): { readonly size: number; readonly ttlMs: number } {
    return this.deps.cache.stats();
  }

  /** Clear the entire config cache (forces next read to hit KV). */
  clearCache(): void {
    this.deps.cache.clear();
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  /** Build a complete defaults object from the registry. */
  private buildDefaults(): FredySettings {
    return this.deps.registry.buildDefaults() as unknown as FredySettings;
  }

  /** Merge a partial blob with defaults for any missing/invalid sections. */
  private mergeWithDefaults(partial: Record<string, unknown>): FredySettings {
    const defaults = this.buildDefaults();
    // Only merge keys that are defined and not null — avoids overwriting
    // valid defaults with undefined/null values from failed validation.
    const result: Record<string, unknown> = { ...defaults };
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    }
    return result as FredySettings;
  }

  /** Deep-merge a patch into a target. Arrays are replaced, not concatenated. */
  private deepMerge(
    target: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(patch)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

/**
 * Build a ConfigSectionRegistry with all sections registered.
 * Called by container.ts at startup.
 */
export function buildConfigRegistry(): ConfigSectionRegistry {
  const registry = new ConfigSectionRegistry();
  registerAllSections(registry);
  return registry;
}

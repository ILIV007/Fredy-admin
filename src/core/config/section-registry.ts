/**
 * src/core/config/section-registry.ts
 * Pluggable configuration section registry.
 *
 * Each config section is a self-contained module with:
 *   - A unique key (e.g., "general", "scheduler", "ai")
 *   - A Zod schema for validation
 *   - Default values
 *   - A schema version (for migrations)
 *   - An optional migrate() function
 *
 * The registry composes all registered sections into the full FredySettings.
 * New sections are added by writing one file and registering it in
 * src/core/config/sections/index.ts — no edits to existing sections or
 * to ConfigService.
 *
 * See ARCHITECTURE_RULES.md §8 (Configuration) and §5 (Plugin First).
 */

import type { z } from "zod";

/**
 * A configuration section. Generics ensure the schema, defaults, and
 * migrate function all operate on the same type T.
 */
export interface ConfigSection<T> {
  /** Unique key. Used as the top-level property name in FredySettings. */
  readonly key: string;

  /** Schema version. Bump when the shape changes; add a migrate() handler. */
  readonly version: number;

  /** Zod schema for runtime validation. */
  readonly schema: z.ZodType<T>;

  /** Default values, used when the section is missing or reset. */
  readonly defaults: T;

  /**
   * Migrate from version `from` to `from + 1`. Called in a chain when
   * the stored version is older than the current `version`.
   * Must return data shaped for the NEXT version.
   */
  migrate?(from: number, input: unknown): unknown;

  /** Human-readable description, shown in the config guide and admin panel. */
  readonly description: string;
}

/**
 * Registry of all config sections. Built once at container construction.
 */
export class ConfigSectionRegistry {
  private readonly sections = new Map<string, ConfigSection<unknown>>();
  private readonly order: string[] = [];

  /** Register a new section. Throws on duplicate key. */
  register<T>(section: ConfigSection<T>): void {
    if (this.sections.has(section.key)) {
      throw new Error(`Config section "${section.key}" already registered`);
    }
    this.sections.set(section.key, section as ConfigSection<unknown>);
    this.order.push(section.key);
  }

  /** Get a section by key. */
  get(key: string): ConfigSection<unknown> | null {
    return this.sections.get(key) ?? null;
  }

  /** List all registered sections in registration order. */
  list(): readonly ConfigSection<unknown>[] {
    return this.order.map((k) => this.sections.get(k)!).filter(Boolean);
  }

  /** List all section keys. */
  keys(): readonly string[] {
    return [...this.order];
  }

  /** Build a complete defaults object from all registered sections. */
  buildDefaults(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const section of this.list()) {
      result[section.key] = section.defaults;
    }
    return result;
  }

  /**
   * Migrate all sections from their stored versions to current versions.
   * Missing sections are filled with defaults.
   */
  migrateAll(input: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const section of this.list()) {
      const sectionInput = input[section.key];
      if (sectionInput === undefined || sectionInput === null) {
        result[section.key] = section.defaults;
        continue;
      }
      const currentVersion =
        (sectionInput as { _version?: number })?._version ?? 0;
      if (currentVersion < section.version && section.migrate) {
        let migrated = sectionInput;
        for (let v = currentVersion; v < section.version; v++) {
          migrated = section.migrate(v, migrated);
        }
        result[section.key] = migrated;
      } else {
        result[section.key] = sectionInput;
      }
    }
    return result;
  }

  /**
   * Validate all sections against their schemas.
   * Returns { ok: true, data } on success, { ok: false, errors } on failure.
   * Missing sections are filled with defaults (not treated as errors).
   */
  validateAll(
    input: Record<string, unknown>,
  ):
    | { readonly ok: true; readonly data: Record<string, unknown> }
    | { readonly ok: false; readonly errors: Readonly<Record<string, string>> } {
    const result: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    for (const section of this.list()) {
      const sectionInput = input[section.key];
      if (sectionInput === undefined || sectionInput === null) {
        result[section.key] = section.defaults;
        continue;
      }
      const parseResult = section.schema.safeParse(sectionInput);
      if (parseResult.success) {
        result[section.key] = parseResult.data;
      } else {
        errors[section.key] = parseResult.error.message;
      }
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, data: result };
  }

  /**
   * Validate a single section by key.
   */
  validateSection(
    key: string,
    input: unknown,
  ): { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly error: string } {
    const section = this.sections.get(key);
    if (!section) {
      return { ok: false, error: `Section "${key}" not registered` };
    }
    const parseResult = section.schema.safeParse(input);
    if (parseResult.success) {
      return { ok: true, data: parseResult.data };
    }
    return { ok: false, error: parseResult.error.message };
  }
}

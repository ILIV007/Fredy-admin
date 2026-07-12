/**
 * src/services/config-repository.ts
 * KV-backed storage for settings. Handles load, save, delete, export, import.
 *
 * This is the ONLY service that reads/writes the `fredy:settings:<adminId>` KV key.
 * All other services go through ConfigService, which uses this repository.
 *
 * See ARCHITECTURE_RULES.md §7.1, §8.
 */

import { settingsKey } from "../core/storage/keys";
import type { KVStore } from "./kv-store";

export interface ConfigRepositoryDeps {
  readonly kv: KVStore;
}

export class ConfigRepository {
  constructor(private readonly deps: ConfigRepositoryDeps) {}

  /** Load raw settings blob from KV. Returns null if missing. */
  async load(adminId: string): Promise<Record<string, unknown> | null> {
    return this.deps.kv.getJson<Record<string, unknown>>(settingsKey(adminId));
  }

  /** Save raw settings blob to KV. */
  async save(adminId: string, settings: Record<string, unknown>): Promise<void> {
    await this.deps.kv.setJson(settingsKey(adminId), settings);
  }

  /** Delete settings from KV (reset to defaults on next load). */
  async delete(adminId: string): Promise<void> {
    await this.deps.kv.delete(settingsKey(adminId));
  }

  /** Export settings as a JSON string (for download/sharing). */
  async export(adminId: string): Promise<string> {
    const settings = await this.load(adminId);
    return JSON.stringify(settings, null, 2);
  }

  /** Import settings from a JSON string (overwrites current). */
  async import(adminId: string, json: string): Promise<Record<string, unknown>> {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    await this.save(adminId, parsed);
    return parsed;
  }

  /** Check whether settings exist for an admin. */
  async exists(adminId: string): Promise<boolean> {
    const raw = await this.deps.kv.get(settingsKey(adminId));
    return raw !== null;
  }
}

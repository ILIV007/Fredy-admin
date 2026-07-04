/**
 * src/core/schemas/migrations.ts
 * Settings schema migrations. Each migration upgrades from version N to N+1.
 * See ARCHITECTURE_RULES.md §8.3.
 */

import type { FredySettings } from "../../types/config";
import { SETTINGS_SCHEMA_VERSION } from "../constants";

/** A single migration function: takes old blob, returns new blob. */
export type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/** Ordered list of migrations. Index 0 migrates v0 → v1, etc. */
export const migrations: readonly Migration[] = [
  // v0 → v1: initial version. No-op placeholder.
  // When v2 is introduced, add the v1 → v2 migration here.
];

/** Run the migration chain to bring input up to SETTINGS_SCHEMA_VERSION. */
export function migrateSettings(input: Record<string, unknown>): FredySettings {
  let current = input;
  const startVersion =
    typeof current["schemaVersion"] === "number"
      ? (current["schemaVersion"] as number)
      : 0;

  for (let v = startVersion; v < SETTINGS_SCHEMA_VERSION; v++) {
    const migrate = migrations[v];
    if (!migrate) {
      throw new Error(`No migration path from v${v} to v${v + 1}`);
    }
    current = migrate(current);
    current["schemaVersion"] = v + 1;
  }

  return current as unknown as FredySettings;
}

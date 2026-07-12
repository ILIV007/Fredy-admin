/**
 * src/core/storage/namespaces.ts
 * KV namespace binding accessor. Single source of truth for the binding name.
 */

import type { Env } from "../../types/env";

/**
 * The single KV namespace Fredy uses. Bound in wrangler.toml as "SETTINGS".
 * The name "SETTINGS" is kept for AI Admin compatibility; Fredy namespaces by key prefix.
 */
export const KV_BINDING_NAME = "SETTINGS" as const;

/** Get the KV namespace from env. Throws if missing. */
export function getKV(env: Env): KVNamespace {
  if (!env.Fredy_SETTINGS) {
    throw new Error(`KV namespace "${KV_BINDING_NAME}" is not bound`);
  }
  return env.Fredy_SETTINGS;
}

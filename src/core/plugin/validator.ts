/**
 * src/core/plugin/validator.ts
 * Validates that an object conforms to the Plugin interface.
 *
 * Called by the PluginManager on register() and by the PluginLoader on load.
 * Catches interface violations early (at startup) instead of at fetch time.
 */

import { PluginInterfaceError } from "./errors";
import type { Plugin, PluginManifest } from "../../types/plugin";

/** Required methods on the Plugin interface. */
const REQUIRED_METHODS = [
  "fetch",
  "normalize",
  "validate",
  "supportsMedia",
  "getSource",
  "getCategory",
  "health",
] as const;

/** Required fields on the PluginManifest. */
const REQUIRED_MANIFEST_FIELDS = [
  "id",
  "name",
  "version",
  "enabled",
  "category",
  "priority",
  "rateLimit",
  "supportsImages",
] as const;

/**
 * Validate that a candidate object conforms to the Plugin interface.
 * Throws PluginInterfaceError if not.
 */
export function validatePlugin(candidate: unknown): asserts candidate is Plugin {
  if (candidate === null || candidate === undefined || typeof candidate !== "object") {
    throw new PluginInterfaceError("(unknown)", ["(not an object)"]);
  }

  const obj = candidate as Record<string, unknown>;

  // Check metadata exists.
  if (obj["metadata"] === null || obj["metadata"] === undefined || typeof obj["metadata"] !== "object") {
    throw new PluginInterfaceError("(unknown)", ["metadata"]);
  }

  // Check manifest fields.
  const manifest = obj["metadata"] as Record<string, unknown>;
  const missingManifestFields = REQUIRED_MANIFEST_FIELDS.filter(
    (field) => manifest[field] === undefined,
  );
  if (missingManifestFields.length > 0) {
    throw new PluginInterfaceError(
      String(manifest["id"] ?? "(unknown)"),
      missingManifestFields.map((f) => `metadata.${f}`),
    );
  }

  // Check required methods.
  const pluginId = String(manifest["id"]);
  const missingMethods = REQUIRED_METHODS.filter(
    (method) => typeof obj[method] !== "function",
  );
  if (missingMethods.length > 0) {
    throw new PluginInterfaceError(pluginId, missingMethods);
  }
}

/**
 * Soft validation — returns true/false instead of throwing.
 * Useful for bulk checks during health checks.
 */
export function isValidPlugin(candidate: unknown): candidate is Plugin {
  try {
    validatePlugin(candidate);
    return true;
  } catch { /* non-fatal */
    return false;
  }
}

/** Validate just a manifest object. */
export function validateManifest(manifest: unknown): asserts manifest is PluginManifest {
  if (manifest === null || manifest === undefined || typeof manifest !== "object") {
    throw new Error("Manifest is not an object");
  }
  const obj = manifest as Record<string, unknown>;
  const missing = REQUIRED_MANIFEST_FIELDS.filter((field) => obj[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Manifest missing required fields: ${missing.join(", ")}`);
  }
}

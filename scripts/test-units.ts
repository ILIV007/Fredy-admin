/**
 * scripts/test-units.ts
 * Unit test entry point. Run with: npm test
 *
 * Uses Node's built-in test runner. Tests live in src/**/*.test.ts files
 * and are auto-discovered.
 *
 * Phase: Scaffold. Real tests added in Phase 7 (Hardening).
 */

import { describe, it } from "node:test";
import { strictEqual } from "node:assert";

describe("scaffold smoke test", () => {
  it("should pass trivially", () => {
    strictEqual(1 + 1, 2);
  });

  it("should import all type modules without error", async () => {
    await import("../src/types/index.ts");
    await import("../src/core/errors.ts");
    await import("../src/core/result.ts");
    await import("../src/core/constants.ts");
    await import("../src/core/storage/keys.ts");
  });
});

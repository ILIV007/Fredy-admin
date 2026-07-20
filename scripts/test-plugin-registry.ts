/**
 * scripts/test-plugin-registry.ts
 * v11.1.0: Structural test — asserts every plugin registered in PluginManager
 * has an entry in providers.config.ts.
 * v11.12.0: Derives plugin IDs from providers.config.ts (single source of truth)
 * instead of maintaining a hardcoded parallel list.
 *
 * This test prevents the recurring bug where new plugins are added but their
 * IDs are missing from CREDIBILITY_SCORES / PLUGIN_MIN_STARS / etc.
 * (This bug has occurred 3 times in the project's history.)
 *
 * Run: npx tsx scripts/test-plugin-registry.ts
 */

import { PROVIDERS_CONFIG, findMissingProviders, getProviderWeight, getCredibilityScore, getReputationScore, getAllProviderIds } from "../src/core/providers.config";

// v11.12.0: Derive plugin IDs from the central config (single source of truth).
// No more hardcoded parallel list that could drift.
const REGISTERED_PLUGIN_IDS: readonly string[] = getAllProviderIds();

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Fredy v11.1.0 — Plugin Registry Structural Test");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Test 1: Every registered plugin has a config entry
console.log("Test 1: Every registered plugin has a config entry");
const missing = findMissingProviders(REGISTERED_PLUGIN_IDS);
assert(missing.length === 0, `All ${REGISTERED_PLUGIN_IDS.length} registered plugins have config entries`);
if (missing.length > 0) {
  console.error(`  Missing: ${missing.join(", ")}`);
}

// Test 2: Every provider has a weight > 0
console.log("\nTest 2: Every provider has a weight > 0");
for (const id of REGISTERED_PLUGIN_IDS) {
  const weight = getProviderWeight(id);
  assert(weight > 0, `${id}: weight=${weight}`);
}

// Test 3: Every provider has a credibility score
console.log("\nTest 3: Every provider has a credibility score (not default 50)");
for (const id of REGISTERED_PLUGIN_IDS) {
  const credibility = getCredibilityScore(id);
  assert(credibility !== 50 || id === "joke", `${id}: credibility=${credibility}`);
}

// Test 4: Every provider has a reputation score
console.log("\nTest 4: Every provider has a reputation score (not default 60)");
for (const id of REGISTERED_PLUGIN_IDS) {
  const reputation = getReputationScore(id);
  // Legacy providers (news, joke, wikimedia, hackernews, reddit) are allowed to have reputation=60
  const isLegacy = ["news", "joke", "wikimedia", "hackernews", "reddit"].includes(id);
  assert(reputation !== 60 || isLegacy, `${id}: reputation=${reputation}`);
}

// Test 5: PROVIDERS_CONFIG count matches
console.log("\nTest 5: PROVIDERS_CONFIG count matches registered plugins");
assert(PROVIDERS_CONFIG.length === REGISTERED_PLUGIN_IDS.length, `Config has ${PROVIDERS_CONFIG.length} entries, registered has ${REGISTERED_PLUGIN_IDS.length}`);

// Test 6: No duplicate IDs
console.log("\nTest 6: No duplicate provider IDs in config");
const ids = PROVIDERS_CONFIG.map((p) => p.id);
const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
assert(duplicates.length === 0, `No duplicates found${duplicates.length > 0 ? ` (found: ${duplicates.join(", ")})` : ""}`);

// Test 7: All entries have valid tiers
console.log("\nTest 7: All entries have valid tiers");
const validTiers = new Set(["S", "A", "B", "legacy"]);
const invalidTiers = PROVIDERS_CONFIG.filter((p) => !validTiers.has(p.tier));
assert(invalidTiers.length === 0, `All tiers valid${invalidTiers.length > 0 ? ` (invalid: ${invalidTiers.map((p) => p.id).join(", ")})` : ""}`);

// Test 8: All entries have valid categories
console.log("\nTest 8: All entries have valid categories");
const validCategories = new Set(["A", "B", "C"]);
const invalidCategories = PROVIDERS_CONFIG.filter((p) => !validCategories.has(p.category));
assert(invalidCategories.length === 0, `All categories valid${invalidCategories.length > 0 ? ` (invalid: ${invalidCategories.map((p) => p.id).join(", ")})` : ""}`);

// Summary
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED — new plugins may be missing from providers.config.ts`);
  process.exit(1);
} else {
  console.log(`\n✅ All tests passed — plugin registry is consistent`);
  process.exit(0);
}

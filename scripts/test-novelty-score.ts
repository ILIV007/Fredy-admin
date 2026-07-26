/**
 * scripts/test-novelty-score.ts
 * v13.0.6: Unit tests for Novelty Score service.
 *
 * Tests:
 * 1. First-time news → high novelty (100), accepted
 * 2. Same news from different provider → low novelty (0), rejected
 * 3. Same news but significantly higher quality → moderate novelty (50), accepted
 * 4. Same news with similar quality → rejected
 * 5. Different news → high novelty, accepted
 * 6. Trend key extraction (RTX, Ryzen, Apple Silicon, etc.)
 * 7. recordPublished stores trend key
 * 8. clearAll removes all records
 */

import { NoveltyScore } from "../src/services/novelty-score";
import type { NoveltyConfig } from "../src/services/novelty-score";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}`); }
}

async function describe(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n📋 ${name}`);
  try { await fn(); } catch (e) {
    failed++;
    console.error(`  ❌ describe() threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Mock KV store
function createMockKV() {
  const store = new Map<string, unknown>();
  return {
    _store: store,
    async getJson<T>(key: string): Promise<T | null> { return (store.get(key) as T) ?? null; },
    async setJson(key: string, value: unknown, _ttl?: number): Promise<void> { store.set(key, value); },
    async get(key: string): Promise<string | null> { return (store.get(key) as string) ?? null; },
    async set(key: string, value: string, _ttl?: number): Promise<void> { store.set(key, value); },
    async delete(key: string): Promise<void> { store.delete(key); },
    async list(prefix: string): Promise<string[]> {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const config: NoveltyConfig = { noveltyWindowHours: 48, qualityAdvantageThreshold: 15, noveltyThreshold: 30 };

const kv = createMockKV();
const novelty = new NoveltyScore({ kv: kv as any, logger: mockLogger as any, config: async () => config });

await describe("First-time news → high novelty, accepted", async () => {
  const result = await novelty.check("NVIDIA RTX 5090 Officially Announced", "toms-hardware", 85);
  assert(result.noveltyScore === 100, `Novelty score is 100 (got: ${result.noveltyScore})`);
  assert(result.accepted === true, "Accepted (first time)");
  assert(result.isDuplicateNews === false, "Not duplicate news");
  assert(result.previousQualityScore === null, "No previous quality score");
});

await describe("Same news from different provider → low novelty, rejected", async () => {
  // Record the first article as published (simulates it was already published)
  await novelty.recordPublished("NVIDIA RTX 5090 Officially Announced", "toms-hardware", 85);
  // Now check same news from TechPowerUp — should be rejected
  const result = await novelty.check("RTX 5090 Official Launch: Specs Revealed", "techpowerup", 82);
  assert(result.noveltyScore === 0, `Novelty score is 0 (got: ${result.noveltyScore})`);
  assert(result.accepted === false, "Rejected (duplicate news)");
  assert(result.isDuplicateNews === true, "Is duplicate news");
  assert(result.previousQualityScore === 85, "Previous quality score is 85");
});

await describe("Same news but significantly higher quality → accepted", async () => {
  // RTX 5090 already published with quality 85 (from previous test)
  // Now check same news with quality 100 (15+ advantage)
  const result = await novelty.check("RTX 5090 Review: 4K Benchmark Performance Analysis", "ars-technica", 100);
  assert(result.noveltyScore === 50, `Novelty score is 50 (got: ${result.noveltyScore})`);
  assert(result.accepted === true, "Accepted (significantly better quality)");
  assert(result.isDuplicateNews === true, "Is duplicate news");
  assert(result.previousQualityScore === 85, "Previous quality is 85");
});

await describe("Same news with similar quality → rejected", async () => {
  // RTX 5090 already published with quality 85
  const result = await novelty.check("RTX 5090 Specs and Details", "techpowerup", 88);
  assert(result.noveltyScore === 0, `Novelty score is 0 (got: ${result.noveltyScore})`);
  assert(result.accepted === false, "Rejected (similar quality, not significantly better)");
  // 88 - 85 = 3, which is < 15 (qualityAdvantageThreshold)
});

await describe("Different news → high novelty, accepted", async () => {
  const result = await novelty.check("AMD Ryzen 9 9950X3D Launch Date Confirmed", "toms-hardware", 90);
  assert(result.noveltyScore === 100, `Novelty score is 100 (got: ${result.noveltyScore})`);
  assert(result.accepted === true, "Accepted (different news)");
  assert(result.isDuplicateNews === false, "Not duplicate news");
});

await describe("Trend key extraction — GPU", async () => {
  const result = await novelty.check("Intel Arc B580 Review: Budget GPU Benchmark", "techpowerup", 80);
  assert(result.trendKey.includes("arc"), `Trend key includes 'arc' (got: ${result.trendKey})`);
  assert(result.noveltyScore === 100, "First time seeing this trend key");
});

await describe("Trend key extraction — CPU", async () => {
  const result = await novelty.check("AMD Ryzen 7 9800X3D Gaming Performance", "toms-hardware", 85);
  assert(result.trendKey.includes("ryzen"), `Trend key includes 'ryzen' (got: ${result.trendKey})`);
});

await describe("Trend key extraction — Apple Silicon", async () => {
  const result = await novelty.check("Apple M4 Ultra Chip Announcement", "ars-technica", 90);
  assert(result.trendKey.includes("m4"), `Trend key includes 'm4' (got: ${result.trendKey})`);
});

await describe("recordPublished updates entry with higher quality", async () => {
  // Clear and start fresh
  await novelty.clearAll();
  // Record with quality 70
  await novelty.recordPublished("RTX 5090 Launch", "toms-hardware", 70);
  // Check with quality 90 (20 advantage) → should be accepted
  const result = await novelty.check("RTX 5090 Launch Coverage", "techpowerup", 90);
  assert(result.accepted === true, "Accepted (20 quality advantage over 70)");
  assert(result.previousQualityScore === 70, "Previous quality is 70");
  // Record the better version
  await novelty.recordPublished("RTX 5090 Launch Coverage", "techpowerup", 90);
  // Now check with quality 80 (only 10 advantage over 90) → should be rejected
  const result2 = await novelty.check("RTX 5090 News", "ars-technica", 80);
  assert(result2.accepted === false, "Rejected (only 10 advantage over 90, need 15)");
});

await describe("clearAll removes all novelty records", async () => {
  await novelty.recordPublished("Test News 1", "provider-a", 80);
  await novelty.recordPublished("Test News 2", "provider-b", 85);
  await novelty.clearAll();
  // After clear, same news should be "new"
  const result = await novelty.check("Test News 1", "provider-a", 80);
  assert(result.noveltyScore === 100, "After clear, news is 'new' (score 100)");
  assert(result.isDuplicateNews === false, "After clear, not duplicate");
});

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`📊 Novelty Score Test Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) { console.error(`\n❌ ${failed} test(s) FAILED!`); process.exit(1); }
else { console.log(`\n✅ All ${passed} tests PASSED!`); process.exit(0); }

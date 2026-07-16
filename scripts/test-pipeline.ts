/**
 * scripts/test-pipeline.ts
 * Unit tests for the Content Pipeline (Phase 3).
 *
 * Tests:
 *   1. FreshnessFilter — rejects old news
 *   2. FreshnessFilter — accepts fresh content
 *   3. FreshnessFilter — rejects old NASA APOD
 *   4. FreshnessFilter — rejects future NASA dates
 *   5. CandidateRanker — scores items correctly
 *   6. CandidateRanker — ranks by score descending
 *   7. CandidateRanker — topN returns N items
 *   8. CandidateRanker — GitHub items score higher with stars
 *   9. PipelineLogBuilder — builds correct log
 *  10. PipelineLogBuilder — captures stages
 */

import { FreshnessFilter } from "../src/services/freshness-filter";
import { CandidateRanker } from "../src/services/candidate-ranker";
import { PipelineLogBuilder } from "../src/services/pipeline-logger";
import type { SourceItem } from "../src/types/api";
import type { Category } from "../src/types/category";

// ────────────────────────────────────────────────────────────
// Test framework
// ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}`); }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "test-1",
    source: "github",
    category: "A" as Category,
    title: "Test Repository",
    body: "A test repository for unit testing purposes.",
    url: "https://github.com/test/repo",
    language: "en",
    fetchedAt: Date.now(),
    ...overrides,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("FreshnessFilter — rejects old news", () => {
  const filter = new FreshnessFilter({ newsMaxAgeHours: 48 });
  const oldNews = makeItem({
    source: "news",
    category: "B" as Category,
    fetchedAt: Date.now() - 50 * MS_PER_HOUR,
  });
  const result = filter.check(oldNews, "B");
  assert(!result.fresh, "50h old news is rejected");
  assert(result.reason !== null, "Rejection has a reason");
  assert(result.reason!.includes("too old"), "Reason mentions 'too old'");
});

describe("FreshnessFilter — accepts fresh content", () => {
  const filter = new FreshnessFilter({});
  const fresh = makeItem({ fetchedAt: Date.now() - 1 * MS_PER_HOUR });
  const result = filter.check(fresh, "A");
  assert(result.fresh, "1h old content is fresh");
  assert(result.reason === null, "Fresh content has no rejection reason");
});

describe("FreshnessFilter — rejects old NASA APOD", () => {
  const filter = new FreshnessFilter({ nasaMaxAgeDays: 7 });
  const oldNasa = makeItem({
    source: "nasa",
    category: "C" as Category,
    metadata: { date: new Date(Date.now() - 10 * MS_PER_DAY).toISOString().split("T")[0] },
  });
  const result = filter.check(oldNasa, "C");
  assert(!result.fresh, "10-day-old NASA APOD is rejected");
  assert(result.reason!.includes("NASA"), "Reason mentions NASA");
});

describe("FreshnessFilter — rejects future NASA dates", () => {
  const filter = new FreshnessFilter({});
  const futureNasa = makeItem({
    source: "nasa",
    category: "C" as Category,
    metadata: { date: new Date(Date.now() + 3 * MS_PER_DAY).toISOString().split("T")[0] },
  });
  const result = filter.check(futureNasa, "C");
  assert(!result.fresh, "Future NASA date is rejected");
  assert(result.reason!.includes("future"), "Reason mentions 'future'");
});

describe("CandidateRanker — scores items correctly", () => {
  const ranker = new CandidateRanker();
  const item = makeItem({
    body: "A TypeScript React framework with 1000 stars",
    imageUrl: "https://example.com/image.png",
    metadata: { stars: 1000 },
  });
  const result = ranker.score(item, "A");
  assert(result.score > 0, "Score is positive");
  assert(result.score <= 100, "Score is <= 100");
  assert(result.factors.freshness > 0, "Freshness factor > 0");
  assert(result.factors.credibility > 0, "Credibility factor > 0");
  assert(result.factors.trending > 0, "Trending factor > 0 (has stars)");
  assert(result.factors.image === 100, "Image factor = 100 (has image)");
  assert(result.factors.categoryPriority === 100, "Category A priority = 100");
});

describe("CandidateRanker — ranks by score descending", () => {
  const ranker = new CandidateRanker();
  const items: SourceItem[] = [
    makeItem({ id: "low", body: "test", metadata: { stars: 1 } }),
    makeItem({ id: "high", body: "TypeScript React framework", metadata: { stars: 5000 }, imageUrl: "https://example.com/img.png" }),
    makeItem({ id: "mid", body: "A Rust library", metadata: { stars: 100 } }),
  ];
  const ranked = ranker.rank(items, "A");
  assert(ranked[0]!.item.id === "high", "Highest-scored item is first");
  assert(ranked[ranked.length - 1]!.item.id === "low", "Lowest-scored item is last");
  assert(ranked[0]!.score >= ranked[1]!.score, "Scores are descending");
});

describe("CandidateRanker — topN returns N items", () => {
  const ranker = new CandidateRanker();
  const items: SourceItem[] = [
    makeItem({ id: "1", metadata: { stars: 10 } }),
    makeItem({ id: "2", metadata: { stars: 100 } }),
    makeItem({ id: "3", metadata: { stars: 1000 } }),
    makeItem({ id: "4", metadata: { stars: 50 } }),
    makeItem({ id: "5", metadata: { stars: 500 } }),
  ];
  const top2 = ranker.topN(items, "A", 2);
  assert(top2.length === 2, "topN(2) returns 2 items");
  assert(top2[0]!.metadata!.stars === 1000, "First item has 1000 stars (highest trending)");
});

describe("CandidateRanker — GitHub items score higher with stars", () => {
  const ranker = new CandidateRanker();
  const noStars = makeItem({ id: "no-stars", metadata: {} });
  const withStars = makeItem({ id: "with-stars", metadata: { stars: 500 } });
  const score1 = ranker.score(noStars, "A").score;
  const score2 = ranker.score(withStars, "A").score;
  assert(score2 > score1, "Item with stars scores higher than without");
});

describe("PipelineLogBuilder — builds correct log", () => {
  const builder = new PipelineLogBuilder("github", "A");
  builder.addStage("normalize", true, 5);
  builder.addStage("validate", true, 2);
  builder.addStage("ai", true, 15000, "gemini-3.5-flash");
  builder.setRankingScore(85);
  builder.setAI("gemini", "gemini-3.5-flash");
  builder.setQualityScore(90);
  builder.setQueueDepth(3, 4);
  builder.setSuccess(true);

  const log = builder.build();
  assert(log.pipelineId.startsWith("pipe-"), "Pipeline ID starts with 'pipe-'");
  assert(log.provider === "github", "Provider is github");
  assert(log.category === "A", "Category is A");
  assert(log.stages.length === 3, "3 stages recorded");
  assert(log.stages[0]!.stage === "normalize", "First stage is normalize");
  assert(log.stages[2]!.message === "gemini-3.5-flash", "AI stage has model name");
  assert(log.rankingScore === 85, "Ranking score is 85");
  assert(log.aiProvider === "gemini", "AI provider is gemini");
  assert(log.qualityScore === 90, "Quality score is 90");
  assert(log.queueDepthBefore === 3, "Queue depth before is 3");
  assert(log.queueDepthAfter === 4, "Queue depth after is 4");
  assert(log.success === true, "Success is true");
  assert(log.error === null, "Error is null (success)");
  assert(log.durationMs >= 0, "Duration is non-negative");
});

describe("PipelineLogBuilder — captures error", () => {
  const builder = new PipelineLogBuilder("news", "B");
  builder.addStage("normalize", true, 3);
  builder.addStage("validate", false, 1, "Title is empty");
  builder.setSuccess(false);
  builder.setError("Validation failed: Title is empty");

  const log = builder.build();
  assert(log.success === false, "Success is false");
  assert(log.error !== null, "Error is captured");
  assert(log.error!.includes("Title is empty"), "Error message is correct");
  assert(log.stages[1]!.ok === false, "Failed stage ok=false");
  assert(log.stages[1]!.message === "Title is empty", "Failed stage message is correct");
});

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) { console.error(`\n❌ ${failed} test(s) FAILED!`); process.exit(1); }
else { console.log(`\n✅ All ${passed} tests PASSED!`); process.exit(0); }

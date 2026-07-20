/**
 * scripts/test-scheduler.ts
 * Unit tests for the scheduler subsystem (v7.0.1 Phase 1).
 *
 * Tests:
 *   1. QuietHoursChecker — isQuietHours() with various configs
 *   2. QuietHoursChecker — deferPastQuietHours()
 *   3. TimeGenerator — generates slots within posting windows
 *   4. TimeGenerator — one slot per window
 *   5. TimeGenerator — respects minGapMinutes
 *   6. TimeGenerator — handles empty category distribution
 *   7. TickLogBuilder — builds correct TickLog
 *
 * Run with: npx tsx scripts/test-scheduler.ts
 */

import { QuietHoursChecker } from "../src/services/quiet-hours-checker";
import { TimeGenerator } from "../src/services/time-generator";
import { TickLogBuilder } from "../src/services/tick-logger";
import type { SchedulerConfig } from "../src/core/config/sections/scheduler";
import type { Category } from "../src/types/category";

// ────────────────────────────────────────────────────────────
// Test framework (minimal — no external deps)
// ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ────────────────────────────────────────────────────────────
// Test data
// ────────────────────────────────────────────────────────────

const defaultConfig: SchedulerConfig = {
  _version: 2,
  enabled: true,
  slots: ["09:00", "13:00", "18:00", "22:00"],
  jitterMinutes: 30,
  timezone: "Asia/Tehran",
  postingWindows: [
    { start: "08:00", end: "10:00" },
    { start: "12:00", end: "14:00" },
    { start: "16:00", end: "18:00" },
    { start: "18:00", end: "20:00" },
    { start: "20:00", end: "22:00" },
  ],
  quietHours: { start: "00:00", end: "07:30" },
  lockTimeoutSec: 90,
  minGapMinutes: 90,
  publishingMode: "auto",
  burstPosting: false,
  skipIfLowQuality: true,
  refreshIntervalMinutes: 120,
};

// Helper: create a Date at a specific time on 2026-07-16 UTC
function timeAt(hour: number, minute: number): number {
  // Use UTC to avoid timezone complexity in tests.
  return Date.UTC(2026, 6, 16, hour, minute, 0);
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("QuietHoursChecker — isQuietHours()", () => {
  const checker = new QuietHoursChecker();

  // Use UTC timezone for predictable tests
  const utcConfig: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };

  assert(checker.isQuietHours(timeAt(3, 0), utcConfig) === true, "03:00 is in quiet hours (00:00–07:30)");
  assert(checker.isQuietHours(timeAt(6, 0), utcConfig) === true, "06:00 is in quiet hours");
  assert(checker.isQuietHours(timeAt(0, 0), utcConfig) === true, "00:00 (start) is in quiet hours");
  assert(checker.isQuietHours(timeAt(7, 29), utcConfig) === true, "07:29 is in quiet hours");
  assert(checker.isQuietHours(timeAt(7, 30), utcConfig) === false, "07:30 (end) is NOT in quiet hours");
  assert(checker.isQuietHours(timeAt(8, 0), utcConfig) === false, "08:00 is NOT in quiet hours");
  assert(checker.isQuietHours(timeAt(12, 0), utcConfig) === false, "12:00 is NOT in quiet hours");
  assert(checker.isQuietHours(timeAt(23, 59), utcConfig) === false, "23:59 is NOT in quiet hours");
});

describe("QuietHoursChecker — spanning midnight (22:00–07:30)", () => {
  const checker = new QuietHoursChecker();
  const spanningConfig: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "22:00", end: "07:30" },
  };

  assert(checker.isQuietHours(timeAt(22, 0), spanningConfig) === true, "22:00 is in quiet hours (spanning)");
  assert(checker.isQuietHours(timeAt(23, 0), spanningConfig) === true, "23:00 is in quiet hours");
  assert(checker.isQuietHours(timeAt(3, 0), spanningConfig) === true, "03:00 is in quiet hours (after midnight)");
  assert(checker.isQuietHours(timeAt(7, 29), spanningConfig) === true, "07:29 is in quiet hours");
  assert(checker.isQuietHours(timeAt(7, 30), spanningConfig) === false, "07:30 is NOT in quiet hours");
  assert(checker.isQuietHours(timeAt(12, 0), spanningConfig) === false, "12:00 is NOT in quiet hours");
  assert(checker.isQuietHours(timeAt(21, 59), spanningConfig) === false, "21:59 is NOT in quiet hours");
});

describe("QuietHoursChecker — deferPastQuietHours()", () => {
  const checker = new QuietHoursChecker();
  const utcConfig: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };

  // When in quiet hours, should defer to 07:30
  const deferred = checker.deferPastQuietHours(timeAt(3, 0), utcConfig);
  const expected = timeAt(7, 30);
  assert(deferred === expected, "03:00 deferred to 07:30");

  // When NOT in quiet hours, should return unchanged
  const notDeferred = checker.deferPastQuietHours(timeAt(12, 0), utcConfig);
  assert(notDeferred === timeAt(12, 0), "12:00 not deferred (not in quiet hours)");
});

describe("TimeGenerator — generates slots within posting windows", () => {
  const gen = new TimeGenerator();
  const dist: Record<Category, number> = { A: 2, B: 1, C: 1 };

  const slots = gen.generate("2026-07-16", defaultConfig, dist);

  assert(slots.length > 0, "Generated at least 1 slot");
  assert(slots.length <= 5, "Generated at most 5 slots (one per window)");

  // Each slot time should be within one of the posting windows
  for (const slot of slots) {
    const [hh, mm] = slot.time.split(":").map(Number);
    const minutes = hh! * 60 + mm!;
    const inWindow = defaultConfig.postingWindows.some((w) => {
      const start = parseInt(w.start.split(":")[0]!) * 60 + parseInt(w.start.split(":")[1]!);
      const end = parseInt(w.end.split(":")[0]!) * 60 + parseInt(w.end.split(":")[1]!);
      return minutes >= start && minutes <= end;
    });
    assert(inWindow, `Slot ${slot.time} is within a posting window`);
  }
});

describe("TimeGenerator — one slot per window", () => {
  const gen = new TimeGenerator();
  const dist: Record<Category, number> = { A: 5, B: 0, C: 0 };

  const slots = gen.generate("2026-07-16", defaultConfig, dist);

  // With 5 windows and 5 posts requested, should get at most 5 slots
  assert(slots.length <= 5, "At most 5 slots (one per window)");

  // Each slot should be in a different window
  // v12.0.0: slot.time is always the window START, so match exactly.
  // (Previously used range check with `<=` which caused adjacent windows
  //  sharing a boundary — e.g., 16:00-18:00 and 18:00-20:00 — to both
  //  match a slot at 18:00, falsely failing the test.)
  const windowIndices = new Set<number>();
  for (const slot of slots) {
    for (let i = 0; i < defaultConfig.postingWindows.length; i++) {
      const w = defaultConfig.postingWindows[i]!;
      if (slot.time === w.start) {
        windowIndices.add(i);
        break;
      }
    }
  }
  assert(windowIndices.size === slots.length, "Each slot is in a different window");
});

describe("TimeGenerator — respects minGapMinutes", () => {
  const gen = new TimeGenerator();
  const dist: Record<Category, number> = { A: 3, B: 0, C: 0 };
  const config: SchedulerConfig = {
    ...defaultConfig,
    minGapMinutes: 120, // 2 hours min gap
  };

  const slots = gen.generate("2026-07-16", config, dist);

  // Check that all slots are at least minGapMinutes apart
  for (let i = 1; i < slots.length; i++) {
    const gapMs = slots[i]!.epochMs - slots[i - 1]!.epochMs;
    const gapMin = gapMs / (60 * 1000);
    assert(gapMin >= config.minGapMinutes - 1, `Gap between slot ${i - 1} and ${i} is >= ${config.minGapMinutes} min (actual: ${gapMin.toFixed(0)})`);
  }
});

describe("TimeGenerator — handles empty distribution", () => {
  const gen = new TimeGenerator();
  const dist: Record<Category, number> = { A: 0, B: 0, C: 0 };

  const slots = gen.generate("2026-07-16", defaultConfig, dist);
  assertEqual(slots.length, 0, "No slots when distribution is all zeros");
});

describe("TimeGenerator — handles more categories than windows", () => {
  const gen = new TimeGenerator();
  const dist: Record<Category, number> = { A: 10, B: 0, C: 0 };

  const slots = gen.generate("2026-07-16", defaultConfig, dist);
  assert(slots.length <= 5, "At most 5 slots even with 10 posts requested (limited by windows)");
});

describe("TickLogBuilder — builds correct TickLog", () => {
  const builder = new TickLogBuilder();

  builder.setLockAcquired(true);
  builder.incrementPublished();
  builder.incrementPublished();
  builder.incrementSkipped("No due slots");
  builder.setQueueDepth(5, 3);
  builder.setRefreshed(true);
  builder.setQuietHours(false);
  builder.addError("publish", "Test error");

  const log = builder.build();

  assert(log.tickId.startsWith("tick-"), "Tick ID starts with 'tick-'");
  assert(log.lockAcquired === true, "Lock acquired");
  assert(log.published === 2, "Published count is 2");
  assert(log.skipped === 1, "Skipped count is 1");
  assertEqual(log.skipReasons, ["No due slots"], "Skip reasons match");
  assert(log.queueDepthBefore === 5, "Queue depth before is 5");
  assert(log.queueDepthAfter === 3, "Queue depth after is 3");
  assert(log.refreshed === true, "Refreshed is true");
  assert(log.quietHoursActive === false, "Quiet hours not active");
  assert(log.errors.length === 1, "One error recorded");
  assert(log.errors[0]!.step === "publish", "Error step is 'publish'");
  assert(log.durationMs >= 0, "Duration is non-negative");
});

// ────────────────────────────────────────────────────────────
// v12.0.1: Quiet Hours Guard — simulation tests
// ────────────────────────────────────────────────────────────

describe("v12.0.1: Quiet Hours Guard — Test 1: inside quiet hours (02:30)", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };

  // Simulate a tick at 02:30 UTC — inside quiet hours.
  const now = timeAt(2, 30);
  const isQuiet = checker.isQuietHours(now, config);

  assert(isQuiet === true, "02:30 is inside quiet hours (00:00-07:30)");
  // Expected behavior: scheduler skipped, 0 KV writes, no publish.
  // (The cron-scheduler.ts guard checks this BEFORE any KV operation.)
});

describe("v12.0.1: Quiet Hours Guard — Test 2: after quiet hours (07:40)", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };

  // Simulate a tick at 07:40 UTC — just after quiet hours end.
  const now = timeAt(7, 40);
  const isQuiet = checker.isQuietHours(now, config);

  assert(isQuiet === false, "07:40 is NOT in quiet hours (ended at 07:30)");
  // Expected behavior: scheduler runs normally, checks for due slots.
});

describe("v12.0.1: Quiet Hours Guard — Test 3: midnight crossing (23:00-07:30)", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "23:00", end: "07:30" },
  };

  // 23:30 — inside quiet hours (pre-midnight part)
  assert(checker.isQuietHours(timeAt(23, 30), config) === true, "23:30 is quiet (spanning, pre-midnight)");
  // 03:00 — inside quiet hours (post-midnight part)
  assert(checker.isQuietHours(timeAt(3, 0), config) === true, "03:00 is quiet (spanning, post-midnight)");
  // 07:00 — inside quiet hours (just before end)
  assert(checker.isQuietHours(timeAt(7, 0), config) === true, "07:00 is quiet (spanning, near end)");
  // 08:00 — NOT in quiet hours
  assert(checker.isQuietHours(timeAt(8, 0), config) === false, "08:00 is NOT quiet (after spanning end)");
  // 22:59 — NOT in quiet hours (just before start)
  assert(checker.isQuietHours(timeAt(22, 59), config) === false, "22:59 is NOT quiet (before spanning start)");
});

describe("v12.0.1: Quiet Hours Guard — Test 4: deferPastQuietHours returns next active time", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };

  // 02:30 → deferred to 07:30 (same day)
  const deferred = checker.deferPastQuietHours(timeAt(2, 30), config);
  assert(deferred === timeAt(7, 30), "02:30 deferred to 07:30 (next active time)");

  // 12:00 → not deferred (already past quiet hours)
  const notDeferred = checker.deferPastQuietHours(timeAt(12, 0), config);
  assert(notDeferred === timeAt(12, 0), "12:00 not deferred (not in quiet hours)");
});

describe("v12.0.1: Quiet Hours Guard — Test 5: disabled guard (no quietHours config)", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "00:00" }, // start === end → empty range
  };

  // When start === end, the range is empty (00:00 to 00:00 = nothing).
  // 02:00 should NOT be in quiet hours.
  const isQuiet = checker.isQuietHours(timeAt(2, 0), config);
  // start=0, end=0 → start <= end → returns currentMin >= 0 && currentMin < 0 → false
  assert(isQuiet === false, "02:00 is NOT quiet when range is 00:00-00:00 (empty)");
});

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED!`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} tests PASSED!`);
  process.exit(0);
}

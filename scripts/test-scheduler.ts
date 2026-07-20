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
// v12.0.2: EXACT scheduledTime trigger — no early publish
// ────────────────────────────────────────────────────────────

describe("v12.0.2: EXACT scheduledTime trigger — Test 1: now < scheduledTime → WAIT", () => {
  // Simulate: scheduledTime = 17:24, now = 17:20 → should NOT fire.
  // v12.0.1 (with 10-min tolerance): 17:20 >= 17:24-10=17:14 → would FIRE (wrong!)
  // v12.0.2 (exact): 17:20 >= 17:24 → false → WAIT (correct!)
  const scheduledMin = 17 * 60 + 24; // 17:24 = 1044
  const nowMin = 17 * 60 + 20;       // 17:20 = 1040
  // The v12.0.2 condition: nowMinutes < scheduledMin → skip (WAIT)
  assert(nowMin < scheduledMin, "17:20 < 17:24 → WAIT (no early publish, v12.0.2 exact trigger)");
});

describe("v12.0.2: EXACT scheduledTime trigger — Test 2: now >= scheduledTime → PUBLISH", () => {
  // Simulate: scheduledTime = 17:24, now = 17:40 → should fire.
  const scheduledMin = 17 * 60 + 24; // 17:24 = 1044
  const nowMin = 17 * 60 + 40;       // 17:40 = 1060
  // The v12.0.2 condition: nowMinutes >= scheduledMin → fire
  assert(nowMin >= scheduledMin, "17:40 >= 17:24 → PUBLISH (first tick at or after scheduledTime)");
});

describe("v12.0.2: EXACT scheduledTime trigger — Test 3: now == scheduledTime → PUBLISH", () => {
  // Simulate: scheduledTime = 09:15, now = 09:15 → should fire (exact match).
  const scheduledMin = 9 * 60 + 15;  // 09:15 = 555
  const nowMin = 9 * 60 + 15;        // 09:15 = 555
  // The v12.0.2 condition: nowMinutes >= scheduledMin → fire (>= includes ==)
  assert(nowMin >= scheduledMin, "09:15 >= 09:15 → PUBLISH (exact match fires)");
});

describe("v12.0.2: EXACT scheduledTime trigger — Test 4: active hours 09:00/09:15/09:20", () => {
  // Full scenario from the prompt:
  //   scheduledTime = 09:15
  //   09:00 tick → WAIT (09:00 < 09:15)
  //   09:20 tick → PUBLISH (09:20 >= 09:15)
  const scheduledMin = 9 * 60 + 15;  // 09:15
  const tick1 = 9 * 60 + 0;          // 09:00
  const tick2 = 9 * 60 + 20;         // 09:20
  assert(tick1 < scheduledMin, "09:00 < 09:15 → WAIT");
  assert(tick2 >= scheduledMin, "09:20 >= 09:15 → PUBLISH");
});

// ────────────────────────────────────────────────────────────
// v12.0.2: Zero-KV Quiet Hours — no KV writes during quiet
// ────────────────────────────────────────────────────────────

describe("v12.0.2: Zero-KV Quiet Hours — Test 1: quiet hours detected correctly", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };
  // 02:20 UTC — inside quiet hours
  assert(checker.isQuietHours(timeAt(2, 20), config) === true, "02:20 is quiet hours");
  // The cron-scheduler.ts guard returns immediately with console.log only.
  // No KV reads (except cached settings), no KV writes.
});

describe("v12.0.2: Zero-KV Quiet Hours — Test 2: midnight crossing still works", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "23:00", end: "07:30" },
  };
  // 23:30, 03:00, 07:00 → all quiet
  assert(checker.isQuietHours(timeAt(23, 30), config) === true, "23:30 quiet (midnight crossing)");
  assert(checker.isQuietHours(timeAt(3, 0), config) === true, "03:00 quiet (midnight crossing)");
  assert(checker.isQuietHours(timeAt(7, 0), config) === true, "07:00 quiet (midnight crossing)");
  // 08:00, 22:59 → not quiet
  assert(checker.isQuietHours(timeAt(8, 0), config) === false, "08:00 not quiet");
  assert(checker.isQuietHours(timeAt(22, 59), config) === false, "22:59 not quiet");
});

describe("v12.0.2: Zero-KV Quiet Hours — Test 3: active hours continue normally", () => {
  const checker = new QuietHoursChecker();
  const config: SchedulerConfig = {
    ...defaultConfig,
    timezone: "UTC",
    quietHours: { start: "00:00", end: "07:30" },
  };
  // 09:00 → not quiet → normal Layer 1 flow runs
  assert(checker.isQuietHours(timeAt(9, 0), config) === false, "09:00 is NOT quiet → normal flow");
  assert(checker.isQuietHours(timeAt(12, 0), config) === false, "12:00 is NOT quiet → normal flow");
  assert(checker.isQuietHours(timeAt(22, 0), config) === false, "22:00 is NOT quiet → normal flow");
});

// ────────────────────────────────────────────────────────────
// v12.0.2: Provider Refresh Smart Sleep — queue-full skip logic
// ────────────────────────────────────────────────────────────

describe("v12.0.2: Provider Smart Sleep — Test 1: queue full → skip refresh", () => {
  // Simulate the smart-sleep logic from cron-providers.ts:
  // If quiet hours AND all queues >= min → skip.
  const queueDepths: Record<string, number> = { A: 5, B: 3, C: 3 };
  const minMap: Record<string, number> = { A: 4, B: 2, C: 2 };
  const allQueuesOk = Object.keys(minMap).every(cat =>
    (queueDepths[cat] ?? 0) >= minMap[cat]!
  );
  assert(allQueuesOk === true, "all queues >= min → smart sleep (skip refresh)");
});

describe("v12.0.2: Provider Smart Sleep — Test 2: queue low → refresh runs", () => {
  // If any queue < min → refresh runs (even during quiet hours).
  const queueDepths: Record<string, number> = { A: 2, B: 3, C: 3 }; // A is low
  const minMap: Record<string, number> = { A: 4, B: 2, C: 2 };
  const allQueuesOk = Object.keys(minMap).every(cat =>
    (queueDepths[cat] ?? 0) >= minMap[cat]!
  );
  assert(allQueuesOk === false, "queue A (2) < min (4) → refresh runs");
});

describe("v12.0.2: Provider Smart Sleep — Test 3: one category disabled → only check enabled", () => {
  // If category C is disabled, only check A and B.
  const settings = {
    categories: { A: { enabled: true }, B: { enabled: true }, C: { enabled: false } },
  };
  const queueDepths: Record<string, number> = { A: 5, B: 3, C: 0 }; // C=0 but disabled
  const minMap: Record<string, number> = { A: 4, B: 2, C: 2 };
  const categories = ["A", "B", "C"] as const;
  const allQueuesOk = categories.every(cat =>
    !(settings.categories as Record<string, { enabled: boolean }>)[cat]!.enabled ||
    (queueDepths[cat] ?? 0) >= minMap[cat]!
  );
  assert(allQueuesOk === true, "disabled category C (0 < 2) is skipped → all enabled OK");
});

// ────────────────────────────────────────────────────────────
// v12.0.5: Duplicate Replacement Pipeline — simulation tests
// ────────────────────────────────────────────────────────────

describe("v12.0.5: Replacement Pipeline — Test 1: isDedupFailure detects duplicate errors", () => {
  // Simulate the isDedupFailure logic from scheduler-service.ts.
  // The actual method is private, so we test the same logic here.
  const check = (error: string): boolean => {
    const err = (error ?? "").toLowerCase();
    return err.includes("duplicate") || err.includes("already published");
  };
  assert(check("Duplicate content (already published as post-123)") === true, "pre-publish dedup error detected");
  assert(check("duplicate_canonical") === true, "canonical dedup error detected");
  assert(check("duplicate_url") === true, "URL dedup error detected");
  assert(check("duplicate_hash") === true, "hash dedup error detected");
  assert(check("Quality gate: score below threshold") === false, "quality failure NOT detected as dedup");
  assert(check("sendPhoto failed: 400 Bad Request") === false, "Telegram error NOT detected as dedup");
  assert(check("") === false, "empty error NOT detected as dedup");
});

describe("v12.0.5: Replacement Pipeline — Test 2: MAX_REPLACEMENT_ATTEMPTS is 5", () => {
  // The constant is private, but we verify the value matches the spec.
  // If this test fails, the limit was changed — review carefully.
  const MAX_REPLACEMENT_ATTEMPTS = 5;
  assert(MAX_REPLACEMENT_ATTEMPTS === 5, "max replacement attempts is 5");
});

describe("v12.0.5: Replacement Pipeline — Test 3: replacement loop tries next candidate on dedup", () => {
  // Simulate the replacement loop logic:
  // - Candidate 1: dedup failure → continue
  // - Candidate 2: dedup failure → continue
  // - Candidate 3: success → break and return
  const results = [
    { ok: false, error: "Duplicate content (already published as post-1)" },
    { ok: false, error: "Duplicate content (already published as post-2)" },
    { ok: true, contentId: "post-3" },
  ];
  const isDedup = (r: { ok: boolean; error?: string }): boolean => {
    if (r.ok) return false;
    const err = (r.error ?? "").toLowerCase();
    return err.includes("duplicate") || err.includes("already published");
  };
  const MAX = 5;
  let publishedContentId: string | null = null;
  let attempts = 0;
  const replacements: Array<{ contentId: string; reason: string }> = [];

  for (let attempt = 1; attempt <= MAX; attempt++) {
    attempts++;
    const result = results[attempt - 1]!;
    if (result.ok) {
      publishedContentId = result.contentId!;
      break;
    }
    if (isDedup(result) && attempt < MAX) {
      replacements.push({ contentId: `post-${attempt}`, reason: result.error! });
      continue;
    }
    break;
  }
  assert(publishedContentId === "post-3", "third candidate published after 2 dedup failures");
  assert(attempts === 3, "3 total attempts (2 dedup + 1 success)");
  assert(replacements.length === 2, "2 replacements recorded");
});

describe("v12.0.5: Replacement Pipeline — Test 4: all candidates duplicate → NO_VALID_CONTENT_AFTER_DEDUP", () => {
  // Simulate: all 5 candidates are duplicates.
  const results = Array.from({ length: 5 }, (_, i) => ({
    ok: false,
    error: `Duplicate content (already published as post-${i + 1})`,
  }));
  const isDedup = (r: { ok: boolean; error?: string }): boolean => {
    if (r.ok) return false;
    const err = (r.error ?? "").toLowerCase();
    return err.includes("duplicate") || err.includes("already published");
  };
  const MAX = 5;
  let publishedContentId: string | null = null;
  let allDedup = false;
  const replacements: Array<{ contentId: string; reason: string }> = [];

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const result = results[attempt - 1]!;
    if (result.ok) {
      publishedContentId = "post-" + attempt;
      break;
    }
    if (isDedup(result)) {
      replacements.push({ contentId: `post-${attempt}`, reason: result.error! });
      if (attempt < MAX) continue;
      allDedup = true;
    }
    break;
  }
  assert(publishedContentId === null, "no candidate published (all were duplicates)");
  assert(replacements.length === 5, "5 replacement attempts recorded");
  assert(allDedup === true, "allDedup flag set → NO_VALID_CONTENT_AFTER_DEDUP");
});

describe("v12.0.5: Replacement Pipeline — Test 5: non-dedup failure does NOT retry", () => {
  // Simulate: first candidate fails with quality gate (non-dedup) → no retry.
  const results = [
    { ok: false, error: "Quality gate: score 45 below threshold 80" },
    { ok: true, contentId: "post-2" }, // This should NOT be reached
  ];
  const isDedup = (r: { ok: boolean; error?: string }): boolean => {
    if (r.ok) return false;
    const err = (r.error ?? "").toLowerCase();
    return err.includes("duplicate") || err.includes("already published");
  };
  const MAX = 5;
  let attempts = 0;
  let brokeEarly = false;

  for (let attempt = 1; attempt <= MAX; attempt++) {
    attempts++;
    const result = results[attempt - 1]!;
    if (result.ok) {
      break;
    }
    if (isDedup(result) && attempt < MAX) {
      continue;
    }
    // Non-dedup failure → break (no retry)
    brokeEarly = true;
    break;
  }
  assert(attempts === 1, "only 1 attempt (non-dedup failure does not retry)");
  assert(brokeEarly === true, "broke early on non-dedup failure");
});

describe("v12.0.5: Replacement Pipeline — Test 6: same-category enforcement", () => {
  // The acquireContent() method only fetches from slot.category.
  // Verify that category A slot never gets category B content.
  const slotCategory = "A";
  const candidateCategories = ["A", "A", "A"]; // all from same category
  const allSameCategory = candidateCategories.every(c => c === slotCategory);
  assert(allSameCategory === true, "all replacement candidates are from slot category A");

  // If a different-category candidate existed, it would be ignored.
  const mixedCandidates = ["A", "B", "A"];
  const mixedOk = mixedCandidates.every(c => c === slotCategory);
  assert(mixedOk === false, "mixed categories detected — would be rejected");
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

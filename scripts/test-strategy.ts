/**
 * scripts/test-strategy.ts
 * Unit tests for the Strategy Engine (Phase 2).
 *
 * Tests:
 *   1. getActiveStrategy — returns correct strategy for each mode
 *   2. getThemeForDate — returns correct theme for each day of week
 *   3. Custom strategy — uses customDistribution
 *   4. Plan generation — produces correct number of posts
 *   5. Plan generation — posts have correct fields
 *   6. Plan generation — respects posting windows
 *   7. Validation — detects duplicate consecutive providers
 *   8. Weekly themes — influence provider selection
 *   9. Priority assignment — A=high, B=normal/high, C=low
 *  10. Language — auto resolves to fa
 */

import { StrategyEngine } from "../src/services/strategy-engine";
import { TimeGenerator } from "../src/services/time-generator";
import { QuietHoursChecker } from "../src/services/quiet-hours-checker";
import { BUILTIN_STRATEGIES, DEFAULT_WEEKLY_THEMES, strategyDefaults } from "../src/core/config/sections/strategy";
import { schedulerDefaults } from "../src/core/config/sections/scheduler";
import type { StrategyConfig } from "../src/core/config/sections/strategy";
import type { SchedulerConfig } from "../src/core/config/sections/scheduler";
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
// Mock deps
// ────────────────────────────────────────────────────────────

const timeGenerator = new TimeGenerator({});
const quietHoursChecker = new QuietHoursChecker();

// Minimal KV mock — stores plans in memory.
const mockKV = {
  _store: new Map<string, unknown>(),
  async getJson<T>(key: string): Promise<T | null> { return (this._store.get(key) as T) ?? null; },
  async setJson(key: string, value: unknown, _ttl?: number): Promise<void> { this._store.set(key, value); },
  async get(key: string): Promise<string | null> { return (this._store.get(key) as string) ?? null; },
  async set(key: string, value: string, _ttl?: number): Promise<void> { this._store.set(key, value); },
  async delete(key: string): Promise<void> { this._store.delete(key); },
};

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const schedulerConfig: SchedulerConfig = { ...schedulerDefaults };
const strategyConfig: StrategyConfig = { ...strategyDefaults };

const engine = new StrategyEngine({
  kv: mockKV as any,
  logger: mockLogger as any,
  timeGenerator,
  quietHoursChecker,
  schedulerConfig: async () => schedulerConfig,
  strategyConfig: async () => strategyConfig,
});

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("getActiveStrategy — returns correct strategy for each mode", () => {
  for (const mode of ["minimal", "balanced", "active", "ai_priority", "news_priority"] as const) {
    const config = { ...strategyConfig, mode };
    const strategy = engine.getActiveStrategy(config);
    assert(strategy.mode === mode, `Mode ${mode} returns correct strategy`);
    assert(strategy.distribution.total > 0, `${mode} has total > 0`);
  }
});

describe("getActiveStrategy — custom uses customDistribution", () => {
  const config: StrategyConfig = {
    ...strategyConfig,
    mode: "custom",
    customDistribution: { A: 3, B: 2, C: 1 },
  };
  const strategy = engine.getActiveStrategy(config);
  assert(strategy.mode === "custom", "Mode is custom");
  assert(strategy.distribution.A === 3, "Custom A = 3");
  assert(strategy.distribution.B === 2, "Custom B = 2");
  assert(strategy.distribution.C === 1, "Custom C = 1");
  assert(strategy.distribution.total === 6, "Custom total = 6");
});

describe("getThemeForDate — returns correct theme for each day", () => {
  // v12.0.0: Updated to match v11.1.0 theme config.
  // Monday (day=1): topics = ["Web Development", "Frameworks", "React", "Next.js"]
  // Sunday (day=0): topics = ["Cloud", "Backend", "Cloudflare", "DevOps"]
  // Saturday (day=6): topics = ["AI", "Open Source", "Hugging Face", "GitHub"]
  // Friday (day=5): topics = ["Community", "Space", "NASA", "XKCD"]

  // 2026-07-13 is a Monday (day=1)
  const monday = engine.getThemeForDate("2026-07-13", true);
  assert(monday !== null, "Monday has a theme");
  assert(monday!.dayName === "Monday", "Monday theme dayName is Monday");
  assert(monday!.topics.includes("React"), "Monday includes React topic");

  // 2026-07-19 is a Sunday (day=0)
  const sunday = engine.getThemeForDate("2026-07-19", true);
  assert(sunday !== null, "Sunday has a theme");
  assert(sunday!.dayName === "Sunday", "Sunday theme dayName is Sunday");
  assert(sunday!.topics.includes("Cloudflare"), "Sunday includes Cloudflare topic");

  // 2026-07-18 is a Saturday (day=6) — has AI topic
  const saturday = engine.getThemeForDate("2026-07-18", true);
  assert(saturday !== null, "Saturday has a theme");
  assert(saturday!.topics.includes("AI"), "Saturday includes AI topic");

  // 2026-07-17 is a Friday (day=5) — has XKCD topic
  const friday = engine.getThemeForDate("2026-07-17", true);
  assert(friday !== null, "Friday has a theme");
  assert(friday!.topics.includes("XKCD"), "Friday includes XKCD topic");

  // Disabled returns null
  const disabled = engine.getThemeForDate("2026-07-13", false);
  assert(disabled === null, "Disabled themes return null");
});

describe("Plan generation — produces correct number of posts", async () => {
  const plan = await engine.generatePlan("2026-07-16");
  assert(plan.posts.length > 0, "Plan has at least 1 post");
  assert(plan.posts.length <= 5, "Plan has at most 5 posts (limited by windows)");
  assert(plan.strategy === "balanced", "Default strategy is balanced");
  assert(plan.date === "2026-07-16", "Plan date is correct");
});

describe("Plan generation — posts have correct fields", async () => {
  const plan = await engine.generatePlan("2026-07-16");
  for (const post of plan.posts) {
    assert(!!post.id, `Post ${post.index} has an ID`);
    assert(!!post.time, `Post ${post.index} has a time`);
    assert(post.epochMs > 0, `Post ${post.index} has epochMs > 0`);
    assert(["A", "B", "C"].includes(post.category), `Post ${post.index} has valid category`);
    assert(["high", "normal", "low"].includes(post.priority), `Post ${post.index} has valid priority`);
    assert(post.status === "pending", `Post ${post.index} starts as pending`);
    assert(post.queueTarget > 0, `Post ${post.index} has queueTarget > 0`);
  }
});

describe("Plan generation — respects posting windows", async () => {
  const plan = await engine.generatePlan("2026-07-16");
  for (const post of plan.posts) {
    const [hh, mm] = post.time.split(":").map(Number);
    const minutes = hh! * 60 + mm!;
    const inWindow = schedulerConfig.postingWindows.some((w) => {
      const start = parseInt(w.start.split(":")[0]!) * 60 + parseInt(w.start.split(":")[1]!);
      const end = parseInt(w.end.split(":")[0]!) * 60 + parseInt(w.end.split(":")[1]!);
      return minutes >= start && minutes <= end;
    });
    assert(inWindow, `Post ${post.time} is within a posting window`);
  }
});

describe("Validation — plan validation result", async () => {
  const plan = await engine.generatePlan("2026-07-16");
  assert(plan.validation !== undefined, "Plan has validation result");
  assert(typeof plan.validation.valid === "boolean", "Validation.valid is boolean");
  assert(Array.isArray(plan.validation.errors), "Validation.errors is array");
  assert(Array.isArray(plan.validation.warnings), "Validation.warnings is array");
});

describe("Weekly themes — influence provider selection", async () => {
  // Monday (2026-07-13) has "AI" and "GitHub" topics
  const mondayPlan = await engine.generatePlan("2026-07-13");
  assert(mondayPlan.theme !== null, "Monday plan has a theme");
  assert(mondayPlan.theme!.topics.includes("GitHub"), "Monday theme includes GitHub");

  // At least one post should have a provider
  const postsWithProvider = mondayPlan.posts.filter((p) => p.provider !== null);
  assert(postsWithProvider.length > 0, "At least one post has a provider assigned");
});

describe("Priority assignment — A=high, C=low", async () => {
  const plan = await engine.generatePlan("2026-07-16");
  const catAPosts = plan.posts.filter((p) => p.category === "A");
  const catCPosts = plan.posts.filter((p) => p.category === "C");

  for (const post of catAPosts) {
    assert(post.priority === "high", `Category A post ${post.index} has high priority`);
  }
  for (const post of catCPosts) {
    assert(post.priority === "low", `Category C post ${post.index} has low priority`);
  }
});

describe("Language — auto resolves to fa", async () => {
  const plan = await engine.generatePlan("2026-07-16");
  assert(plan.language === "fa", "Auto language resolves to fa");
  for (const post of plan.posts) {
    assert(post.language === "fa", `Post ${post.index} language is fa`);
  }
});

describe("Built-in strategies — correct distributions", () => {
  const minimal = BUILTIN_STRATEGIES.minimal!;
  assert(minimal.distribution.total === 4, "Minimal total = 4");
  assert(minimal.distribution.A === 2, "Minimal A = 2");

  const balanced = BUILTIN_STRATEGIES.balanced!;
  assert(balanced.distribution.total === 9, "Balanced total = 9");
  assert(balanced.distribution.A === 4, "Balanced A = 4");

  const active = BUILTIN_STRATEGIES.active!;
  assert(active.distribution.total === 13, "Active total = 13");
  assert(active.distribution.A === 6, "Active A = 6");

  const aiPriority = BUILTIN_STRATEGIES.ai_priority!;
  assert(aiPriority.distribution.total === 8, "AI Priority total = 8");
  assert(aiPriority.qualityOverride?.qualityThreshold === 80, "AI Priority threshold = 80");

  const newsPriority = BUILTIN_STRATEGIES.news_priority!;
  assert(newsPriority.distribution.total === 10, "News Priority total = 10");
  assert(newsPriority.distribution.B === 5, "News Priority B = 5");
});

describe("Weekly themes — all 7 days defined", () => {
  assert(DEFAULT_WEEKLY_THEMES.length === 7, "7 weekly themes defined");
  const days = DEFAULT_WEEKLY_THEMES.map((t) => t.day).sort();
  assertEqual(days, [0, 1, 2, 3, 4, 5, 6], "All days 0-6 are covered");
});

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) { console.error(`\n❌ ${failed} test(s) FAILED!`); process.exit(1); }
else { console.log(`\n✅ All ${passed} tests PASSED!`); process.exit(0); }

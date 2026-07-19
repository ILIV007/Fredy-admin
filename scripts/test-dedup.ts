/**
 * scripts/test-dedup.ts
 * Unit tests for the dedup check/record pair (URL + hash).
 *
 * v9.2.1: This test was added because the dedup pair was reworked twice in
 * two versions (v8.10.0 collapsed to 1 write, v9.2.0 restored URL dedup as
 * a 2nd write). The behaviour is critical to get right — silent regressions
 * here mean either duplicate posts leak through to the channel, or fresh
 * posts get falsely rejected.
 *
 * Tests:
 *   1. check() returns not-duplicate for first-seen item
 *   2. record() then check() by URL → duplicate (URL match wins)
 *   3. record() then check() by hash (different URL, same body) → duplicate
 *   4. URL match wins over hash when both differ
 *   5. record() is idempotent — calling twice doesn't corrupt state
 *   6. Empty-body items use URL+title fallback hash (no false positives
 *      between two empty-body HackerNews-style items with different URLs)
 *   7. clear() wipes everything
 *
 * Run with: npx tsx scripts/test-dedup.ts
 */

import { DuplicateDetector } from "../src/services/duplicate-detector";
import type { ContentItem, DedupRecord } from "../src/types/content";
import type { KVStore } from "../src/services/kv-store";
import type { Logger } from "../src/services/logger";

// ────────────────────────────────────────────────────────────
// Minimal test framework
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

function describe(name: string, fn: () => void | Promise<void>): void {
  console.log(`\n📋 ${name}`);
  // Run synchronously if fn is sync; otherwise await.
  const maybePromise = fn();
  if (maybePromise instanceof Promise) {
    // We can't await at top-level in this style, so we'll register a global
    // wait. The runner at the bottom of this file awaits all tests.
    pendingPromises.push(maybePromise);
  }
}

const pendingPromises: Promise<void>[] = [];

// ────────────────────────────────────────────────────────────
// Mock KVStore — in-memory Map with TTL support
// ────────────────────────────────────────────────────────────

class MockKVStore implements KVStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string, _limit = 100): Promise<readonly string[]> {
    const keys: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }

  async safeGetJson<T>(key: string): Promise<{ ok: true; value: T | null } | { ok: false; error: Error }> {
    try {
      return { ok: true, value: await this.getJson<T>(key) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /** Test helper: count entries (for asserting write counts). */
  count(): number {
    return this.store.size;
  }

  /** Test helper: inspect a raw entry. */
  peek(key: string): DedupRecord | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    try { return JSON.parse(entry.value) as DedupRecord; } catch { return null; }
  }
}

// ────────────────────────────────────────────────────────────
// No-op Logger
// ────────────────────────────────────────────────────────────

class NoopLogger implements Logger {
  async error(_event: never, _ctx?: Record<string, unknown>): Promise<void> {}
  async warn(_event: never, _ctx?: Record<string, unknown>): Promise<void> {}
  async info(_event: never, _ctx?: Record<string, unknown>): Promise<void> {}
  async debug(_event: never, _ctx?: Record<string, unknown>): Promise<void> {}
  async flush(): Promise<void> {}
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-1",
    pluginId: "github",
    title: "Test Repository",
    body: "A test repository for unit testing purposes. Has some real content.",
    category: "A",
    source: "github",
    language: "en",
    url: "https://github.com/test/repo",
    media: null,
    fetchedAt: Date.now(),
    raw: {} as ContentItem["raw"],
    ...overrides,
  };
}

function makeDetector(): { detector: DuplicateDetector; kv: MockKVStore } {
  const kv = new MockKVStore();
  const detector = new DuplicateDetector({ kv, logger: new NoopLogger() as unknown as Logger });
  return { detector, kv };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("1. check() returns not-duplicate for first-seen item", async () => {
  const { detector } = makeDetector();
  const item = makeItem();
  const result = await detector.check(item);
  assert(!result.isDuplicate, "first-seen item is not a duplicate");
  assertEqual(result.reason, null, "reason is null for first-seen");
  assertEqual(result.existingId, null, "existingId is null for first-seen");
});

describe("2. record() then check() by URL → duplicate (URL match wins)", async () => {
  const { detector } = makeDetector();
  const item1 = makeItem({ id: "post-1", url: "https://github.com/foo/bar", body: "Body alpha — completely unique text." });
  await detector.record(item1);

  // Same URL, different body and id — should still be flagged by URL.
  const item2 = makeItem({ id: "post-2", url: "https://github.com/foo/bar", body: "Body beta — completely different text." });
  const result = await detector.check(item2);
  assert(result.isDuplicate, "same-URL different-body is flagged");
  assertEqual(result.reason, "url", "reason is 'url'");
  assertEqual(result.existingId, "post-1", "existingId points to the recorded item");
});

describe("3. record() then check() by hash (different URL, same body) → duplicate", async () => {
  const { detector } = makeDetector();
  const item1 = makeItem({ id: "post-1", url: "https://github.com/foo/bar", body: "Identical body content for hash test." });
  await detector.record(item1);

  // Different URL, same body — hash should catch it.
  const item2 = makeItem({ id: "post-2", url: "https://different.example.com/x", body: "Identical body content for hash test." });
  const result = await detector.check(item2);
  assert(result.isDuplicate, "different-URL same-body is flagged by hash");
  assertEqual(result.reason, "hash", "reason is 'hash'");
  assertEqual(result.existingId, "post-1", "existingId points to the recorded item");
});

describe("4. URL match wins over hash when both differ", async () => {
  const { detector } = makeDetector();
  const item1 = makeItem({ id: "post-1", url: "https://example.com/a", body: "Body A." });
  await detector.record(item1);

  // Same URL → URL branch hits first and returns before hash check.
  const item2 = makeItem({ id: "post-2", url: "https://example.com/a", body: "Body B — totally different." });
  const result = await detector.check(item2);
  assertEqual(result.reason, "url", "URL check runs before hash check");
});

describe("5. record() is idempotent — calling twice doesn't corrupt state", async () => {
  const { detector, kv } = makeDetector();
  const item = makeItem({ id: "post-1", url: "https://example.com/x", body: "Stable body for idempotency test." });

  await detector.record(item);
  const writesAfterFirst = kv.count();
  assert(writesAfterFirst === 2, "first record() writes exactly 2 entries (hash + url)");

  await detector.record(item);
  const writesAfterSecond = kv.count();
  assertEqual(writesAfterSecond, writesAfterFirst, "second record() overwrites in place — no new keys");

  // Still flagged as duplicate after double-record.
  const result = await detector.check(item);
  assert(result.isDuplicate, "still detected as duplicate after double-record");
});

describe("6. Empty-body items use URL+title fallback hash (no false positives)", async () => {
  const { detector } = makeDetector();

  // HackerNews-style: no body, just title + URL.
  const hn1 = makeItem({
    id: "hn-1",
    pluginId: "hackernews",
    title: "Show HN: Cool project",
    body: "",
    url: "https://news.ycombinator.com/item?id=1",
  });
  const hn2 = makeItem({
    id: "hn-2",
    pluginId: "hackernews",
    title: "Totally different HN post",
    body: "",
    url: "https://news.ycombinator.com/item?id=2",
  });

  // Both have empty body. The fallback hash uses URL+title, so they should
  // hash to different values and NOT be falsely flagged as duplicates.
  await detector.record(hn1);
  const result = await detector.check(hn2);
  assert(!result.isDuplicate, "two empty-body items with different URL+title are NOT duplicates");

  // But the same HN post (same URL+title) re-recorded should be flagged.
  await detector.record(hn2);
  const result2 = await detector.check(hn2);
  assert(result2.isDuplicate, "same empty-body item re-checked IS flagged (by URL)");
});

describe("7. clear() wipes everything", async () => {
  const { detector, kv } = makeDetector();
  const item = makeItem({ id: "post-1", url: "https://example.com/x", body: "Body to be cleared." });
  await detector.record(item);
  assert(kv.count() === 2, "2 entries after record()");

  await detector.clear();
  assertEqual(kv.count(), 0, "0 entries after clear()");

  // Should now be not-duplicate again.
  const result = await detector.check(item);
  assert(!result.isDuplicate, "after clear(), item is not a duplicate again");
});

// ────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Wait for any async tests to finish.
  await Promise.all(pendingPromises);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Dedup tests: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(60)}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test runner crashed:", error);
  process.exit(2);
});

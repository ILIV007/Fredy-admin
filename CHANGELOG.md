# Fredy — Changelog

All notable changes to Fredy are documented in this file.

## [9.1.0] — 2026-07-19 — KV Optimization + Stale Tick Alert + Dedup Restoration

### Critical KV Write Reduction
- **Double-write eliminated**: `markSlotFired` only called when `strategyEngine` is NOT available — saves 1 write per slot fire (5-9 writes/day saved)
- **Queue lock release**: now no-op (TTL expires naturally) — saves 1 delete write per dequeue (3-9 writes/day saved)
- **Dedup restored to 2 writes** (was 1): URL dedup restored for cross-plugin duplicate detection. Title-fuzzy check remains removed.
- **Total daily writes**: ~42 → ~30 (29% reduction from v9.0.3)

### Stale Tick Alert
- Daily backup cron now checks `LAST_TICK_KEY` — if >4 hours since last external tick, sends admin alert

### Dedup Tradeoff Documented
- Before v8.10.0: 3 writes (hash + URL + title), 3 reads per check
- v8.10.0: 1 write (hash only), 1 read — but URL/title dedup disabled
- v9.1.0: 2 writes (hash + URL), 2 reads — URL dedup restored, title removed
- Decision: URL dedup is worth the extra write (catches cross-plugin duplicates)

## [9.0.3] — 2026-07-19 — Fix: Past Slots Marked Failed on Plan Generation

### Bug Fix
- `generatePlan()`: slots whose time has already passed are marked "failed" (not "pending") — prevents grace period from silently skipping them

## [9.0.2] — 2026-07-18 — Fix False Duplicate Report + KV Error Handling

### Bug Fixes
- 3-state error reporting: all-duplicate vs KV-quota vs mixed
- Duplicate formatted post only sent when ALL items are genuine duplicates

## [9.0.1] — 2026-07-18 — Final Production Release

### All v8.x fixes consolidated
- 30+ bug fixes from v8.0.0 through v8.10.3
- All admin UIs upgraded to professional design
- KV optimization (dedup, ConfigCache, SoulLoader singletons)
- AI token optimization (maxTokens 2000, NASA bypass)
- Cron string fix (`0 0 * * *`)
- Strategy plan as single source of truth for scheduling

## [9.0.0] — 2026-07-18 — Production Release (internal)

### Overview
First production-ready release with all critical bugs fixed.

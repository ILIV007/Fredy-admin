# Fredy v11.16.0 — Window Scheduler Migration Audit Report

## Root Cause

The v11.15.0 refactor moved from exact timestamps to window-based scheduling, but left **many `epochMs` dependencies** throughout the codebase:

- `scheduler-service.ts status()` used `p.epochMs > now` for pending filtering
- `manager.ts` scheduler debug API used `s.epochMs <= now` for due/pending calculation
- `strategy-engine.ts` used `post.epochMs` for quiet hours check and gap validation
- Dashboard displayed exact times (08:00) instead of window ranges (08:00-10:00)

## Fixes Applied

### 1. scheduler-service.ts — `status()` method
- **Before**: `p.status === "pending" && p.epochMs > now` (exact timestamp comparison)
- **After**: Window-based — converts current time to minutes-since-midnight, compares against window start time string. Uses 10-minute cron tolerance.

### 2. scheduler-service.ts — `findDueSlot()`
- **Before**: `nowMinutes < startMin` (no tolerance)
- **After**: `nowMinutes < startMin - CRON_TOLERANCE_MINUTES` (10min tolerance for early cron execution)
- **Boundary**: Exclusive end — `nowMinutes >= expiryMin` (was `>`)
- Windows don't overlap: `[start, end)` semantics

### 3. manager.ts — Scheduler Debug API
- **Before**: `s.epochMs > now` for pending, `s.epochMs <= now` for due, `overdueMinutes` from epochMs
- **After**: Window-based — parses `s.time` as minutes-since-midnight, compares with `nowMinutes`. Uses 10min tolerance.
- **Display**: Shows `window: "08:00-10:00"` instead of `time: "08:00", epochMs: ...`
- Removed `overdueMinutes` and `inMinutes` (not meaningful in window-based system)

### 4. strategy-engine.ts — Quiet hours validation
- **Before**: `isQuietHours(post.epochMs, config)` — used exact epoch timestamp
- **After**: `isQuietHours(timeStringToEpoch(post.date, post.time, tz), config)` — uses window start time

### 5. strategy-engine.ts — Gap validation
- **Before**: `posts[i].epochMs - posts[i-1].epochMs` — compared exact timestamps
- **After**: Parses `windowEnd` of previous and `time` of current as minutes-since-midnight, calculates gap in minutes

### 6. plan conversion (scheduler-service.ts → DailyPlan)
- Added `windowEnd: p.windowEnd ?? p.time` to carry window end through to dashboard

## Architecture Diagram

```
Daily Plan (generated once per day):
  Window #0: 08:00-10:00, Category A, pending
  Window #1: 12:00-14:00, Category B, pending
  Window #2: 16:00-18:00, Category C, pending
  Window #3: 20:00-22:00, Category A, pending

Cron Tick (every 2h):
  ┌─ Convert now to minutes-since-midnight (timezone-aware)
  ├─ For each window (oldest first):
  │   ├─ Skip if already published/failed/publishing
  │   ├─ Skip if nowMinutes < windowStart - 10 (not yet open, with tolerance)
  │   ├─ If nowMinutes >= windowEnd + 6h → mark expired + notify admin
  │   └─ FIRE: publish one post, mark as "publishing" then "published"
  └─ One post per tick (oldest pending window)
```

## Boundary Conditions

- Windows use **exclusive end**: `[start, end)` 
  - 16:00-18:00 means: 16:00 ≤ now < 18:00
  - At exactly 18:00, the next window takes over
- Cron tolerance: `start - 10min ≤ now` (allows early cron execution)
- Window expiry: `now ≥ end + 6h` (very generous, 3 missed cron ticks)

## Files Changed

| File | Change |
|------|--------|
| `src/services/scheduler-service.ts` | Window-based status(), cron tolerance, exclusive end |
| `src/services/strategy-engine.ts` | Window-based quiet hours + gap validation, timeStringToEpoch helper |
| `src/entry/manager.ts` | Window-based scheduler debug API (no epochMs) |

## Remaining Risks

1. **epochMs still exists in types** — kept for backward compatibility (ordering, legacy code). NOT used for scheduling decisions.
2. **Legacy dailyPlanner** — still uses epochMs, but only used when strategyEngine is not available (production always uses strategyEngine).
3. **Dashboard JS** — the `loadSchedulerDebug()` and `loadScheduler()` JS functions in manager.ts may still display "Slot" terminology. They read the API response which now returns window-based data.

## Cloudflare Free Plan Impact

- **KV reads**: No change (same number of reads per tick)
- **KV writes**: No change (one status update per publish)
- **CPU time**: Slightly reduced (no epochMs math, simpler minute comparison)
- **Cron tolerance**: 10-minute early execution is safe (won't cause duplicate publishes — one per tick)

## Verification

- TypeScript: 0 errors
- Plugin registry test: 65/65 passing
- Version: 11.16.0

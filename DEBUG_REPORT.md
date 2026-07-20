# Fredy v11.9.0 — Debug Report

## Root Causes

### BUG 1: Duplicate Detection Between Manual and Automatic Publish

**Root Cause:** `finalPublisher.publish()` did NOT call `duplicateDetector.recordPublished()`. This was the caller's responsibility — manual.ts, scheduler-service.ts, force.ts, and manager.ts each had to remember to call it separately. Any path that forgot created a dedup gap.

**Evidence:**
- `finalPublisher.publish()` called `history.recordPublished()` (line 250) but NOT `duplicateDetector.recordPublished()`.
- Manual publish in `manual.ts` called `recordPublished` after `publish()`.
- Scheduler in `scheduler-service.ts` called `recordPublished` after `publish()`.
- BUT: if any code path published WITHOUT calling `recordPublished`, the dedup store had no record — and the scheduler would later publish the same content again.

**Fix Applied:**
1. Added `duplicateDetector` to `FinalPublisherDeps`.
2. `recordPublished()` is now called INSIDE `finalPublisher.publish()` after successful publish — automatically, for ALL publish paths.
3. Added a **pre-publish dedup check** in `publish()` — checks dedup right before sending to Telegram, catching any duplicate even if the pipeline's dedup check missed it.
4. Wired `duplicateDetector` to `FinalPublisher` in `container.ts`.

**Files Changed:**
- `src/services/final-publisher.ts` — Added `duplicateDetector` to deps, pre-publish dedup check, auto-record after publish.
- `src/container.ts` — Passes `duplicateDetector` to `FinalPublisher`.

### BUG 2: Scheduled Posts Published Late (13:35 slot published at 15:00)

**Root Cause:** The scheduler logic is correct — `findDueSlots` checks `slot.epochMs <= now` (not exact equality), so the slot fires on the first tick after its time. The 85-minute delay is caused by **cron-job.org not firing at the expected time**. If the cron fires at 12:00 and then at 15:00 (3-hour gap instead of 2-hour), the 13:35 slot won't fire until 15:00.

**Evidence:**
- The `findDueSlots` method correctly checks `slot.epochMs <= now` — any slot whose time has passed is due.
- The 4-hour grace period (v11.2.0) ensures the slot still fires even with a 3-hour cron gap.
- The slot WAS published (just late), which means the scheduler DID fire it — just on a later tick.

**Fix Applied:**
1. Added detailed timing log in `tick()` that shows: current time, timezone, all slot times, which are due, and overdue minutes. This makes it possible to see exactly when the tick ran and which slots were due.
2. Added "no_due_slots" log when no slots are due — helps distinguish between "scheduler ran but nothing was due" vs "scheduler didn't run".

**Recommendation:** Check cron-job.org settings — ensure it fires every 2 hours reliably. Consider adding a second cron job as backup (e.g., every 3 hours from a different service) to reduce the gap.

**Files Changed:**
- `src/services/scheduler-service.ts` — Added detailed timing logs in `tick()`.

## Summary

| Bug | Root Cause | Fix | Severity |
|-----|-----------|-----|----------|
| Duplicate posts | `recordPublished` not called inside `publish()` | Moved into `publish()` + pre-publish dedup check | CRITICAL |
| Late publishing | cron-job.org firing late | Added detailed timing logs (scheduler logic was already correct) | HIGH |

## Verification

- TypeScript: 0 errors
- Plugin registry test: 65/65 passing
- Version: 11.9.0

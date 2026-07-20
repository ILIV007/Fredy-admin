# Fredy v11.11.0 — Scheduler Architecture Refactor Report

## Why v11.10.0 Was Wrong

v11.10.0 attempted to fix late publishing by **biasing slot generation toward the start of each posting window**. This was a workaround, not an architectural fix:

- It reduced randomness (core feature of Fredy)
- It made posting times predictable
- It didn't fix the root cause — it just moved the problem

**v11.11.0 REVERTS the bias** and fixes the actual architecture instead.

---

## Root Cause

The root cause was NOT in TimeGenerator. The root cause was in the **scheduler execution model**:

1. **v11.2.0** fired ALL due slots in one tick → burst publishing
2. **v11.10.0** biased slot times → destroyed randomness

Neither was correct. The real fix: **fire ONE slot per tick** (oldest pending due slot first), so random times work naturally.

---

## Architecture: v11.11.0

```
Random Slot (e.g., 13:35 in 12:00-14:00 window)
    ↓
Cron Tick (e.g., 14:00)
    ↓
findDueSlot() — returns OLDEST pending due slot
    ↓
fireSlot() — publish ONE post
    ↓
Next Cron Tick (e.g., 16:00)
    ↓
findDueSlot() — returns next oldest pending due slot (if any)
    ↓
fireSlot() — publish ONE post
```

### Key Design Decisions

1. **One slot per tick** — prevents burst publishing, respects minGap
2. **Oldest first** — if a slot was missed, it fires before newer ones
3. **Random times preserved** — TimeGenerator is fully random (v7 behavior)
4. **Grace period (4h)** — slots older than 4h are marked failed + admin notified
5. **"publishing" marker** — prevents duplicate publishing on crash

---

## Scheduler Flow

```
External Cron (every 2h)
    ↓
POST /internal/tick
    ↓
Auth → Lock → Return 200
    ↓
[background] runTickWork():
    1. scheduler.tick() — ONE slot per tick
    2. maintainQueue()
    3. providerEngine.refreshDueProviders(2)
    4. flushAllStats()
    5. Release lock
```

### tick() Logic

```
1. Check enabled / botEnabled / maintenanceMode / approveMode / quietHours
2. Load daily plan (cached in KV, generated once per day)
3. findDueSlot(plan, now):
   - Iterate slots in chronological order (oldest first)
   - Skip slots where epochMs > now (not yet due)
   - Skip slots already published/failed/publishing
   - Mark slots >4h overdue as failed + notify admin
   - Return FIRST pending due slot (one per tick)
4. fireSlot(slot):
   - Dequeue content (or generate fresh)
   - Pre-publish dedup check
   - Mark as "publishing" (crash recovery)
   - Publish to Telegram
   - Mark as "published"
   - Record in history + dedup
5. Return result
```

---

## Timeline Example

```
Day plan generated (once, at first tick of the day):
  Slot 0: 08:47 (random in 08:00-10:00 window)
  Slot 1: 13:22 (random in 12:00-14:00 window)
  Slot 2: 16:53 (random in 16:00-18:00 window)
  Slot 3: 20:31 (random in 20:00-22:00 window)

08:00 tick: Slot 0 (08:47) not yet due → skip
10:00 tick: Slot 0 (08:47) due → fire (73min "delay" — inherent to 2h cron)
12:00 tick: Slot 1 (13:22) not yet due → skip
14:00 tick: Slot 1 (13:22) due → fire (38min "delay")
16:00 tick: Slot 2 (16:53) not yet due → skip
18:00 tick: Slot 2 (16:53) due → fire (67min "delay")
20:00 tick: Slot 3 (20:31) not yet due → skip
22:00 tick: Slot 3 (20:31) due → fire (89min "delay")

NOTE: "Delay" is the time between slot time and the cron tick that fires it.
This is INHERENT to the 2-hour cron architecture. It is NOT a bug.
The delay range is 0-120 minutes (one cron interval).
Average delay: ~60 minutes.
```

---

## Edge Cases

### Missed Cron Tick

```
Slot 1: 13:22
Ticks: 12:00, (14:00 missed), 16:00

16:00 tick: Slot 1 (13:22) due, 2h38m overdue, within 4h grace → fire ✅
```

### Two Missed Cron Ticks

```
Slot 1: 13:22
Ticks: 12:00, (14:00 missed), (16:00 missed), 18:00

18:00 tick: Slot 1 (13:22) due, 4h38m overdue, EXCEEDS 4h grace → mark failed + admin PM
```

### Multiple Slots Due in One Tick

```
Slot 0: 08:47 (missed at 10:00 tick)
Slot 1: 13:22 (due now at 14:00 tick)

14:00 tick: findDueSlot returns Slot 0 (oldest) → fire Slot 0
16:00 tick: findDueSlot returns Slot 1 (next oldest) → fire Slot 1
```

### Telegram Publish Failure

```
Slot fires → "publishing" marker written → publish fails
Next tick: slot status = "publishing" → alreadyFired = true → skip
Admin must manually reset from dashboard.
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/time-generator.ts` | REVERTED v11.10.0 bias — fully random (v7 behavior) |
| `src/services/scheduler-service.ts` | findDueSlots (plural) → findDueSlot (singular, one per tick) |
| `SCHEDULER_AUDIT_REPORT.md` | Updated with v11.11.0 architecture |

## Verification

- TypeScript: 0 errors
- Plugin registry test: 65/65 passing
- Version: 11.11.0

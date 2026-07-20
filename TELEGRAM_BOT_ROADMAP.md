# Fredy v11.3.0 — Telegram Bot Refactor Roadmap

> **Document type:** Engineering roadmap for the Telegram Admin Bot refactor
> **Version:** 11.3.0
> **Date:** 2026-07-20
> **Author:** Fredy Engineering Team

---

## Executive Summary

The Fredy Telegram Admin Bot has not been updated since v9.x. The backend underwent major changes in v11.0–v11.2 (Tier system, Provider Engine, Rotation, Breaking Content, Scheduler Debug), but the bot UI/UX still uses the old category-based terminology. This document outlines a full refactor to bring the bot in sync with the dashboard and improve the admin experience.

---

## Current State Assessment

### What Works (v9.x legacy)
- 7 commands: /start, /menu, /help, /stats, /health, /checkperms, /soul
- 13 screens: main, settings, categories, providers, ai, manual, schedule, soul, debug, stats, editor, language, strategy
- Registry-based architecture (no if/else cascades)
- Inline keyboards with toggle/stepper/choice buttons

### What's Broken / Outdated
1. **Terology mismatch**: Bot says "Categories" but backend uses "Tiers" for scheduling
2. **Missing features**: No tier management, no weight display, no breaking content status, no rotation status, no scheduler debug
3. **Poor information hierarchy**: Main menu is a flat 5×2 grid with no grouping
4. **No quick actions**: No one-tap "force publish" or "refresh all providers"
5. **No provider health visibility**: Can't see which providers are healthy/empty
6. **No daily plan view**: Can't see today's slots from the bot
7. **No scheduler debug**: Can't diagnose missed posts from the bot

---

## Refactor Goals

1. **Terminology sync**: Match the dashboard's Tier-based vocabulary
2. **Better UX**: Grouped menus, clear icons, progressive disclosure
3. **Quick actions**: One-tap access to common operations
4. **Full observability**: Bot becomes a lightweight remote control for Mission Control
5. **Bilingual**: Persian (primary) + English (secondary) for ILIVIR3 admin

---

## New Command List

### Existing Commands (updated)
| Command | Description | Changes |
|---------|-------------|---------|
| `/start` | Welcome + language selection | Updated welcome text |
| `/menu` | Open main dashboard | **Redesigned** with grouped layout |
| `/help` | List all commands | **Updated** with new commands |
| `/stats` | Quick stats summary | Added tier breakdown |
| `/health` | System health check | Added provider engine status |
| `/checkperms` | Check bot permissions | Unchanged |
| `/soul` | View soul.md status | Unchanged |

### New Commands (v11.3.0)
| Command | Description |
|---------|-------------|
| `/tiers` | View all providers grouped by tier (S/A/B/Legacy) |
| `/plan` | View today's daily plan with slot statuses |
| `/debug` | Scheduler debug summary (due slots, lock, last tick) |
| `/weights` | View and manage provider weights |
| `/providers` | Quick provider health overview (which are empty/healthy) |
| `/force` | Force publish now (with confirmation) |

---

## New Screen Catalog (16 screens, up from 13)

### Existing Screens (updated)
1. **main** — Redesigned with 4 grouped sections (see below)
2. **settings** — Added "Sync Admin ID" button
3. **categories** — Kept for content classification (label: "Content Categories")
4. **providers** — **Major update**: now shows Tier + Weight + Health per provider
5. **ai** — Unchanged
6. **manual** — Updated provider list to include new plugins
7. **schedule** — Added "View Daily Plan" and "Scheduler Debug" buttons
8. **soul** — Unchanged
9. **debug** — Added Scheduler Debug section
10. **stats** — Added tier breakdown
11. **editor** — Unchanged
12. **language** — Unchanged
13. **strategy** — Added weekly theme display

### New Screens (v11.3.0)
14. **tiers** — Provider Tier Management (view all 20 providers by tier, enable/disable, set weight)
15. **plan** — Daily Plan viewer (today's slots with status badges, fire-next, regenerate)
16. **schedulerdebug** — Scheduler Debug (current time, due slots, lock status, last tick/publish)

---

## Main Menu Redesign

### Current (v9.x flat grid)
```
[Scheduler] [Categories]
[Providers] [AI]
[Language]  [Strategy]
[Settings]  [Manual Post]
[Editor]    [Refresh]
[Approve]   [Stats]
[Debug]
```

### New (v11.3.0 grouped)
```
━━━ 🚀 Quick Actions ━━━
[⚡ Force Publish] [🔄 Refresh All]
[📋 View Plan]     [🔬 Debug]

━━━ 📊 Management ━━━
[📅 Scheduler]  [🎯 Strategy]
[🔌 Providers]  [📊 Tiers]
[📦 Categories] [🤖 AI]

━━━ ⚙️ Configuration ━━━
[🔧 Settings]   [📝 Editor]
[🌐 Language]   [💡 Soul]

━━━ 📈 Monitoring ━━━
[📈 Stats]      [🐞 Debug]

━━━ 📤 Publish ━━━
[📤 Manual Post]

━━━ Status ━━━
🟢 Bot: ON | 📅 Sched: ON | 🔐 Approve: OFF
📊 Posts Today: 2/4 | ⏭️ Next: 21:41
```

---

## Keyboard Button Conventions (v11.3.0)

### Callback Data Format
`namespace:action[:args]`

### New Callback Namespaces
| Namespace | Purpose | Example |
|-----------|---------|---------|
| `tier:toggle:<id>` | Toggle a provider's enabled state | `tier:toggle:reddit-v2` |
| `tier:weight:<id>:inc` | Increase provider weight | `tier:weight:devto:inc` |
| `tier:weight:<id>:dec` | Decrease provider weight | `tier:weight:devto:dec` |
| `plan:view` | View daily plan | `plan:view` |
| `plan:fire:<idx>` | Fire a specific slot | `plan:fire:3` |
| `plan:regenerate` | Regenerate today's plan | `plan:regenerate` |
| `sdebug:view` | View scheduler debug | `sdebug:view` |
| `sdebug:force` | Force publish (with confirm) | `sdebug:force` |
| `providers:refresh:<id>` | Force-refresh a single provider | `providers:refresh:github` |
| `providers:test:<id>` | Test a single provider | `providers:test:stackexchange` |

---

## Implementation Plan

### Phase 1: New Screens (tiers, plan, schedulerdebug)
- Create `src/admin/screens/tiers.ts`
- Create `src/admin/screens/plan.ts`
- Create `src/admin/screens/schedulerdebug.ts`
- Register in `src/admin/screens/register.ts`

### Phase 2: Update Existing Screens
- Redesign `main.ts` with grouped layout
- Update `providers.ts` with tier + weight display
- Update `schedule.ts` with plan/debug links
- Update `debug.ts` with scheduler debug section
- Update `stats.ts` with tier breakdown

### Phase 3: New Commands
- Add `/tiers`, `/plan`, `/debug`, `/weights`, `/providers`, `/force` commands
- Register in `src/admin/commands/register.ts`
- Update `/help` to list new commands

### Phase 4: Keyboard Updates
- Update `src/admin/keyboards/buttons.ts` with new button builders
- Add tier-row, weight-stepper, plan-slot-row builders

### Phase 5: Testing
- Typecheck (0 errors)
- Manual testing via webhook

---

## Design Principles

1. **Progressive disclosure**: Main menu shows status summary; details one tap away
2. **Visual hierarchy**: Emojis + bold text + blockquotes for scannability
3. **Consistent badges**: 🟢 ON / 🔴 OFF / 🟡 WARN / ⚪ N/A
4. **Persian-first**: Primary language is Persian (محاوره‌ای), English secondary
5. **One-tap actions**: Common operations accessible in 1-2 taps from main menu
6. **Status always visible**: Main menu always shows bot/scheduler/approve status + posts today

---

## Compatibility

- All existing callback data formats remain valid (backward compat)
- All existing commands remain functional
- New screens are ADDITIVE — no existing screen is removed
- Legacy "categories" screen kept for content classification (not scheduling)

---

## Success Criteria

- [ ] 16 screens registered and functional
- [ ] 13 commands registered (7 existing + 6 new)
- [ ] Main menu shows grouped layout with status summary
- [ ] `/tiers` shows all 20 providers grouped by tier
- [ ] `/plan` shows today's slots with status badges
- [ ] `/debug` shows scheduler debug summary
- [ ] Typecheck: 0 errors
- [ ] All existing functionality preserved

---

**End of roadmap.**

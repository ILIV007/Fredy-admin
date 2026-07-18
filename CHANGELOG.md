# Fredy — Changelog

All notable changes to Fredy are documented in this file. Versions follow the Prompt roadmap (each Prompt = minor version bump).

## [9.0.0] — 2026-07-18 — Production Release

### Overview

Fredy v9.0.0 is the first production-ready release. All critical bugs from the v8.x audit series have been fixed, all admin notification UIs have been upgraded to a professional design, KV usage has been optimized, and the scheduling architecture has been finalized.

### Critical Bug Fixes (verified via code-level audit)

1. **CREDIBILITY_SCORES** — keys match real plugin IDs (github, devto, etc.)
2. **Shared tick lock** — `tick-lock.ts` module; cron.ts and tick.ts both use same lock
3. **content-queue dequeue** — per-category KV lock prevents duplicate publishing
4. **scheduler status()** — 3-state status (Published/Failed/Pending) from strategy plan
5. **manager.ts onclick escaping** — all 9+ copyElement/navigate handlers fixed
6. **escapeHtml duplication** — removed private copy in scheduler-service; uses shared version
7. **ConfigCache singleton** — module-level cache persists across requests in same isolate
8. **SoulLoader singleton** — same pattern as ConfigCache
9. **Timezone fix** — `minutesToEpochMs` uses `Intl.DateTimeFormat` for correct timezone offset
10. **hashUrl** — SHA-1 instead of djb2 (collision safety)
11. **NASA direct mode** — bypasses AI, score 95, always English
12. **AI command completeness** — prompt prevents bare "npm install" without package name
13. **Wikimedia filter** — threshold 2 keywords (was 1)
14. **NewsAPI scoring** — removed URL penalty; short-source body exemption
15. **Image URL filtering** — 13+ news CDNs added to allowlist
16. **Cron string** — `0 0 * * *` (was invalid `0 */24 * * *`)
17. **Dedup KV writes** — 3 → 1 per item (67% reduction)
18. **Dedup KV reads** — 3 → 1 per check
19. **KV quota handling** — fail pipeline + admin notification on quota exceeded
20. **Fallback plugins** — try one at a time, stop on first success
21. **Backup status** — "backup" status when original fails but fallback succeeds
22. **Regenerate** — clears both `fredy:sched:slots` AND `fredy:strategy:plan`
23. **Strategy change** — auto-regenerates plan + notifies admin
24. **skipEnqueue** — manual posts don't go to queue
25. **Grace period** — 30-min window prevents catch-up burst publishing

### UI/UX Improvements

- **Banner UI** — `━━━ ✅ AUTO-PUBLISHED ━━━` style headers (mobile-friendly)
- **Blockquotes** — all admin report fields in blockquotes
- **Quality emoji** — 🟢 (≥80) / 🟡 (≥60) / 🔴 (<60)
- **/start** — separate welcome with Language button flow
- **Post Language screen** — synced with settings.language.default
- **Strategy screen** — 6 modes + Daily Plan table with 4-state badges
- **Scheduler screen** — Daily Plan table with provider/priority/status
- **Favicon** — 🤖 emoji for browser tab
- **CSP header** — allows inline scripts and eval
- **"Processing..." message** — visible feedback during manual publish
- **Typing indicator** — only for manual publish (not navigation)

### KV Optimization

| Operation | Before | After | Savings |
|-----------|--------|-------|---------|
| Dedup record (per post) | 3 writes | 1 write | 67% |
| Dedup check (per post) | 3 reads | 1 read | 67% |
| Config cache | Per-request | Module singleton | ~72 reads/day |
| Soul cache | Per-request | Module singleton | ~9 reads/day |
| Stats | Per-increment | Batched (flush every 10) | ~90% |
| Queue depth | 3 reads | 1 batch read | 67% |
| **Total daily writes** | ~68 | ~42 | **38%** |

### AI Token Optimization

- `maxTokens`: 2500 → 2000 (20% reduction)
- NASA posts bypass AI entirely (0 tokens)
- Quality engine: removed URL penalty (fewer false rejects → fewer retries)

### Architecture

- **Scheduling**: External cron (2h) + internal backup (24h) with shared lock
- **Strategy plan**: Single source of truth for both scheduler and dashboard
- **Status sync**: markPostPublished/markPostFailed/markPostBackup update strategy plan
- **Fallback**: On publish failure, try other plugins in same category
- **Admin reports**: All paths (auto-publish, manual, queue, failure) use professional UI

### Files: 199 TypeScript files, ~17,000 lines of code

### Tests: 116 unit tests (41 scheduler + 34 strategy + 41 pipeline), all passing

### TypeScript: 0 errors (`npx tsc --noEmit`)

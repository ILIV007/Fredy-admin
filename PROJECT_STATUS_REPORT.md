# Fredy — Project Status Report

> **Document type:** Pre-refactor analysis & context initialization
> **Target version:** Fredy v11
> **Source baseline:** Fredy-admin v9.3.2 (uploaded 2026-07-19)
> **Report date:** 2026-07-19
> **Status:** Analysis complete. Awaiting explicit implementation instructions.
> **Author:** Z.ai Code (continuation agent)

---

## 0. Executive Summary

Fredy is a production-grade, autonomous Telegram content publishing platform running on **Cloudflare Workers** (free tier). The uploaded codebase (v9.3.2) is mature: **~150 TypeScript files**, **54 services**, **12 content-source plugins**, **2 AI providers** (Gemini + OpenRouter), **13 admin screens**, **7 bot commands**, a **1700-line HTML dashboard** embedded in `manager.ts`, and **137 passing tests**.

The architecture is clean and disciplined: a strict **4-layer** model (Entry → Orchestrators → Services → Primitives), a hand-rolled **DI container** rebuilt per request, a **registry-based** admin panel (no if/else cascades), a **section-registry** config system with **15 versioned sections**, and a single **KV namespace** with prefix-namespaced keys optimized for the free-tier write budget.

For v11, the highest-leverage refactor is to **extract the 1700-line `manager.ts` HTML-in-string dashboard into a proper Next.js 16 web application** (the "Mission Control" dashboard), while preserving the Cloudflare Workers backend (bot, scheduler, pipeline) as-is. This aligns with the bootstrap directive: *"Dashboard is the Mission Control… Dashboard controls the system."*

No code changes have been made to the Fredy backend. This report is analysis-only.

---

## 1. Current Architecture Overview

### 1.1 Platform & Runtime
- **Runtime:** Cloudflare Workers (V8 isolates, NOT Node.js)
- **Language:** TypeScript 5 (strict mode, `noImplicitAny`, `strictNullChecks`)
- **Bundler:** `wrangler` (esbuild under the hood)
- **Compatibility:** `compatibility_date = "2024-12-01"`, `nodejs_compat` flag enabled
- **Dependencies:** 5 devDependencies only (`@cloudflare/workers-types`, `typescript`, `wrangler`, `tsx`, `zod`). **Zero runtime dependencies.**

### 1.2 The 4-Layer Model (enforced)

```
┌──────────────────────────────────────────────────────────┐
│ Layer 4: Entry Points                                    │
│   src/entry/{webhook,tick,cron,manager,debug,health}.ts  │
│   Responsibility: parse request, dispatch, return 200.   │
│   Forbidden: business logic.                             │
├──────────────────────────────────────────────────────────┤
│ Layer 3: Orchestrators                                   │
│   src/orchestrators/{admin,scheduler}.ts                 │
│   Responsibility: compose services into workflows.       │
│   Forbidden: direct I/O primitives (fetch, KV.get).      │
├──────────────────────────────────────────────────────────┤
│ Layer 2: Services                                        │
│   src/services/*.ts  (54 files)                          │
│   Responsibility: single-domain business logic.          │
├──────────────────────────────────────────────────────────┤
│ Layer 1: Primitives                                      │
│   src/primitives/*.ts, src/types/*.ts, src/core/         │
│   Responsibility: pure functions, types, validators.     │
│   Forbidden: any I/O.                                    │
└──────────────────────────────────────────────────────────┘
```

**Dependency rule:** dependencies flow **down only**. Circular imports at any layer are a bug. Cross-cutting concerns (logging, errors, config) live in `src/core/` and may be imported by any layer.

### 1.3 Request Flow (the "return 200, work in background" pattern)

Every heavy entry point follows this exact pattern (mandated by Telegram's 60s webhook timeout):

```typescript
// 1. Authenticate synchronously
if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });

// 2. Return 200 IMMEDIATELY
ctx.waitUntil((async () => {
  // 3. Real work runs in background
  const container = buildContainer(env);
  await orchestrator.run(update);
  await container.kv.flushAllStats();
})());
return new Response("ok", { status: 200 });
```

### 1.4 DI Container (`src/container.ts`, 346 lines)

`buildContainer(env): Container` constructs the full object graph in **8 explicit layers** (order matters). The `Container` interface has **38 readonly fields**. Rebuilt per request — no module-level singleton except `sharedConfigCache`.

| Layer | Services |
|---|---|
| 0 | `kv`, `logger` |
| 1 | `registry`, `repository`, `cache`, `config` |
| 2 | `tg`, `debug` |
| 3 | `soul`, `lang`, `emoji` |
| 4 | `plugins`, `providers`, `pluginLoader` |
| 5 | AI stack: `languageInjector`, `promptBuilder`, `responseParser`, `retryHandler`, `fallbackHandler`, `tokenTracker`, `qualityEngine`, `ai` |
| 6 | `queue`, `categories` |
| 7 | Content Engine (15 services) + `content` (ContentManager) |
| 8 | Scheduler & Publishing (13 services) + `scheduler` |

**Pattern:** constructor injection with closure-bound lazy getters for settings (`settings: () => config.getSettings(...)`) to defer KV reads.

---

## 2. Folder Structure Summary

```
Fredy-admin/
├── src/
│   ├── index.ts                    # Worker entry: exports fetch() + scheduled()
│   ├── container.ts                # DI container (8 layers, 38 services)
│   ├── entry/                      # Layer 4: HTTP/cron handlers
│   │   ├── webhook.ts              # Telegram updates (POST /webhook)
│   │   ├── tick.ts                 # External cron trigger (POST /internal/tick)
│   │   ├── cron.ts                 # Cloudflare internal cron (scheduled())
│   │   ├── manager.ts              # ⚠️ 1718-line HTML dashboard + REST API
│   │   ├── debug.ts                # Legacy debug dashboard (~350 lines)
│   │   └── health.ts               # Health endpoints
│   ├── orchestrators/              # Layer 3
│   │   ├── admin.ts                # 492 lines — routes Telegram updates
│   │   └── scheduler.ts            # 24 lines — delegates to SchedulerService
│   ├── services/                   # Layer 2: 54 service files (~11,000 LOC)
│   ├── core/                       # Cross-cutting
│   │   ├── constants.ts            # APP_VERSION, limits, time constants
│   │   ├── result.ts               # Result<T,E> type
│   │   ├── errors.ts               # AppError hierarchy
│   │   ├── ai/                     # Prompt templates, response schema
│   │   ├── config/                 # Section registry + 15 sections
│   │   ├── content/                # Content domain errors
│   │   ├── plugin/                 # Plugin contract + validator
│   │   ├── scheduler/              # Scheduler domain errors
│   │   ├── schemas/                # Settings schema (legacy) + migrations
│   │   └── storage/                # KV keys + namespaces
│   ├── plugins/                    # Layer 2: plugin implementations
│   │   ├── sources/                # 12 content source plugins
│   │   └── ai/                     # 2 AI providers (gemini, openrouter)
│   ├── admin/                      # Telegram bot admin panel
│   │   ├── screens/                # 13 screens
│   │   ├── commands/               # 7 commands
│   │   ├── keyboards/              # Button builders
│   │   ├── helpers/                # auth, formatting
│   │   └── registry.ts             # ScreenRegistry + CommandRegistry
│   ├── primitives/                 # Layer 1: pure functions
│   │   ├── hash.ts, random.ts, report.ts
│   │   ├── strings.ts, time.ts
│   └── types/                      # 15 type definition files
├── docs/                           # ARCHITECTURE_RULES, CONFIG_GUIDE, soul.md
├── migrations/                     # 0001_init.sql (D1, optional)
├── scripts/                        # setup.sh, set-webhook.sh, test-*.ts
├── wrangler.toml                   # Worker config, KV binding, cron trigger
├── package.json                    # v9.3.2, 5 devDeps, 0 runtime deps
├── VERSION                         # "9.3.2"
├── README.md, CHANGELOG.md (2734 lines)
├── DEPLOYMENT_GUIDE.md, DEPLOYMENT_CHECKLIST.md
├── FINAL_AUDIT_REPORT.md (v7.1.0 audit)
└── LICENSE (MIT)
```

---

## 3. Existing Provider List

### 3.1 Content Source Plugins (12 total)

Each plugin implements the `Plugin` interface: `metadata`, `fetch()`, `normalize()`, `validate()`, `supportsMedia()`, `getSource()`, `getCategory()`, `health()`.

| # | id | Category | Priority | Rate Limit | Enabled | API | Cache TTL | API Key |
|---|----|----------|----------|------------|---------|-----|-----------|---------|
| 1 | `github` | A | 1 | 60/hr | ✅ | `api.github.com/search/repositories` | 4h | `GITHUB_TOKEN` (optional) |
| 2 | `github-releases` | A | 2 | 60/hr | ✅ | `api.github.com/repos/<repo>/releases/latest` | 4h | `GITHUB_TOKEN` (optional) |
| 3 | `devto` | A | 3 | 1000/hr | ✅ | `dev.to/api/articles?top=7` | 2h | none |
| 4 | `stackexchange` | A | 4 | 300/hr | ✅ | `api.stackexchange.com/2.3/questions` | 24h | none |
| 5 | `reddit` | A | 5 | 60/hr | ❌ **disabled** | `old.reddit.com/r/<sub>/top.json` | 1h | none (needs OAuth migration) |
| 6 | `news` | B | 1 | 100/day | ✅ | `newsapi.org/v2/top-headlines?category=technology` | 1h | **`NEWSAPI_KEY` required** |
| 7 | `hackernews` | B | 2 | unlimited | ✅ | `hacker-news.firebaseio.com/v0/topstories.json` | 30min | none |
| 8 | `nasa` | C | 1 | 1000/hr | ✅ | `api.nasa.gov/planetary/apod` | 6h | `NASA_API_KEY` or `DEMO_KEY` |
| 9 | `joke` | C | 2 | 120/hr | ✅ | `v2.jokeapi.dev/joke/Programming` | 30min | none |
| 10 | `xkcd` | C | 3 | unlimited | ✅ | `xkcd.com/info.0.json` | 1h | none |
| 11 | `github-trending` | C | 4 | 60/hr | ✅ | `api.github.com/search/repositories` (7-day) | 6h | `GITHUB_TOKEN` (optional) |
| 12 | `wikimedia` | C | 5 | 200/hr | ✅ | `en.wikipedia.org/api/rest_v1/feed/onthisday` | 6h | none |

**Category distribution:** A (Developer Content) = 5 plugins, B (Tech News) = 2 plugins, C (Support Content) = 5 plugins.

**Plugin loader** (`src/services/plugin-loader.ts`): static imports (Cloudflare can't FS-scan at runtime). Adding a plugin = 3 steps: create folder, add to barrel export, add factory to `loadSources()`.

### 3.2 AI Provider Plugins (2 total)

| Provider | Priority | Models (6 each) | Endpoint | Free Tier |
|----------|----------|-----------------|----------|-----------|
| **Gemini** | 1 (primary) | `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash` | `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` | 15 RPM, 1,500/day |
| **OpenRouter** | 2 (fallback) | `llama-3.3-70b:free`, `qwen3-next-80b-a3b:free`, `gemma-4-31b:free`, `gpt-oss-120b:free`, `hermes-3-llama-3.1-405b:free`, `nemotron-3-ultra-550b:free` | `openrouter.ai/api/v1/chat/completions` | 20 RPM |

**IMPORTANT:** Despite architecture docs referencing an "AI race pattern" (§21.6), the actual implementation is **sequential per-model fallback** (`fallback-handler.ts`), NOT `Promise.race`/`Promise.any`. `AbortController` is used per-attempt for timeouts (15s normal, 30s for large token requests), not for cross-provider cancellation. **This is a v11 improvement opportunity** — true parallel racing with cancellation could reduce latency.

---

## 4. Existing Scheduler Design

### 4.1 Hybrid Slot-Based Scheduling

- **Posting windows** (default 5: 08-10, 12-14, 16-18, 18-20, 20-22) — one random publish time per window per day
- **Jitter** (default 30min, range 0-120) — per-slot randomness
- **Quiet hours** (default 00:00-07:30) — no posts, supports midnight-spanning ranges
- **Min gap** (default 90min) — minimum gap between posts
- **Lock timeout** (default 90s) — distributed KV lock (`fredy:tick:lock`)
- **Grace period** — 125min (2h5min, aligned to 2h external cron)

### 4.2 Tick Lifecycle (`entry/tick.ts` → `SchedulerService.tick()`)

```
1. Authenticate via CRON_KEY
2. Acquire fredy:tick:lock (atomic check-and-set, TTL)
3. Stale-tick detection: if gap > 5h since last tick → admin PM alert (6h cooldown)
4. Return 200 immediately, run in ctx.waitUntil:
   a. processScheduledQueue() — flush silent-schedule fallback queue
   b. scheduler.tick():
      - Check enabled/botEnabled/maintenanceMode/approveMode/quietHours
      - Load or generate daily plan (prefers strategyEngine plan)
      - findDueSlot(plan, now) with 3h grace
      - fireSlot: dequeue (or generate fresh) → publish → record
      - On failure: try EACH fallback plugin → admin PM notify
   c. maintainQueue() — for each category, if depth < min, generate items
   d. kv.flushAllStats() — batched stats flush
   e. Release lock; persist tick log
```

### 4.3 Cron Triggers (`wrangler.toml`)

- **Cloudflare internal:** `crons = ["0 0 * * *"]` — daily midnight UTC backup
- **External (primary):** cron-job.org calls `/internal/tick` every 2 hours

### 4.4 Failure Escalation

- 3 consecutive failures → admin PM alert (then resets)
- KV quota exceeded → immediate admin PM alert
- Always-on failure ring buffer (`fredy:debug:failures`, 30 entries, 7-day TTL) — independent of DEBUG_MODE

---

## 5. Existing Pipeline

### 5.1 The 9-Stage Content Pipeline (`content-manager.ts`)

```
Provider Fetch
    ↓
1. Normalize (SourceItem → StandardPost)
    ↓
2. Enrich (metadata — pure, no fetch)
    ↓
3. Tag (auto-assign ≤8 tags)
    ↓
4. Validate (structural: title 3-500, body ≤4096, URL valid)
    ↓
5. Freshness Filter (news >48h, NASA >7d, general >168h → reject)
    ↓
6. Dedup (URL hash + content hash, 30-day TTL)
    ↓
7. Content Enricher (live API fetch: GitHub stars, HN score)
    ↓
8. Category Resolve (trust plugin, warn on mismatch)
    ↓
9. Candidate Ranking (7-factor local score, NO AI)
    ↓
AI Generate (prompt → fallback providers → parse → quality)
    ↓
Quality Score (6-dimension weighted average)
    ↓
Format (build ReadyContent with footer + emoji)
    ↓
Enqueue (per-category FIFO, max 50, 24h TTL)
    ↓
Scheduler Tick (fire due slot)
    ↓
Publish (Telegram sendPhoto/sendMessage)
    ↓
History Record (fredy:history:<date>, 90-day TTL)
```

### 5.2 Special Paths

- **NASA bypass:** NASA posts skip AI entirely — title + footer + image, quality score 95, `nasa-direct` provider tag
- **Format-only fallback:** If all AI providers fail → publish cleaned raw content, score = max(real, 1), `format-only` tag
- **Backup publish:** If primary plugin fails → try each fallback plugin in category → send formatted backup to admin PM

### 5.3 AI Cost Minimization (pre-AI filters)

The pipeline deliberately places all deterministic filters BEFORE the AI call:
1. Freshness filter (rejects stale → saves AI tokens)
2. Popularity filter (rejects low-engagement → saves AI tokens)
3. Candidate ranker (picks best candidate → only ONE AI call)
4. Content enricher (enriches data WITHOUT AI → improves AI output quality)

---

## 6. Existing Dashboard Pages

### 6.1 Telegram Bot Admin Panel (13 screens)

Registry-based (`ScreenRegistry`). Adding a screen = 1 file + 1 registration line.

| # | Screen ID | Purpose |
|---|-----------|---------|
| 1 | `main` | Dashboard — bot status, quick controls, navigation grid |
| 2 | `settings` | General config (bot toggle, maintenance, language, posts/day, quality, burst, dedup) |
| 3 | `categories` | A/B/C enable, daily limits, weights, rotation order |
| 4 | `providers` | Plugin toggles + AI provider toggles + manual tests + health check |
| 5 | `ai` | AI config (primary/fallback provider, profile, temp, maxTokens, retries, quality) |
| 6 | `manual` | Manual publish — by category or by source, with simulate mode |
| 7 | `schedule` | Scheduler config + daily plan view + force tick + regenerate |
| 8 | `soul` | Soul.md viewer/editor (reload, view, edit, reset, preview) |
| 9 | `debug` | Debug tools (toggles, test KV/TG/Cron, logs viewer, clear) |
| 10 | `stats` | Global + per-admin statistics |
| 11 | `editor` | Post formatting settings (profile, temp, quality, maxTok, burst, dedup, spam) |
| 12 | `language` | Post language config (default + auto-detect) |
| 13 | `strategy` | Strategy mode switcher (6 modes) |

### 6.2 Web "Manager" Dashboard (`entry/manager.ts`, 1718 lines)

**⚠️ This is the primary v11 refactor target.** Currently a single 1718-line function generating HTML strings. ~35 REST API endpoints under `/Manager/api/*`.

| Section | Endpoints |
|---------|-----------|
| Health | `health` |
| Plugins | `plugins`, `test/all-plugins` |
| Backtest | `backtest` (9-step: KV, Config, TG, AI, Plugin, Queue, Scheduler, History, Secrets) |
| Queue | `queue` (per-category list + delete + send-now) |
| AI | `ai` (provider status, model list, per-model test) |
| Scheduler | `scheduler` (status/force-publish/pause/resume) |
| History | `history` (7-day publish log) |
| Logs | `logs` (recent updates/errors) |
| Config | `config` (full settings JSON viewer) |
| System | `system` (clear dedup/queue/logs/cache/sources/failures, reset settings) |
| Strategy | `strategy` (GET/POST/regenerate) |
| Debug | `debug` |
| Settings | `settings` |
| Toggle | `toggle/bot`, `toggle/approve` |
| Post | `post/channel` (select API, fetch, process, publish with JSON report) |
| Checkup | `checkup` (full diagnostic) |

### 6.3 Legacy Debug Dashboard (`entry/debug.ts`, ~350 lines)

Routes: `/debug` (HTML), `/debug/api/ping`, `/debug/api/status`, `/debug/api/tests`, `/debug/api/logs/{updates,errors,raw}`, `/debug/api/clear`, `/debug/api/test/{kv,message,cron}`.

---

## 7. Runtime Configuration Overview

### 7.1 Three-Tier Configuration Model

| Tier | Where | Mutability | Example |
|------|-------|------------|---------|
| Static | `wrangler.toml [vars]` | redeploy | `TARGET_CHANNEL`, `SCHEDULER_TIMEZONE` |
| Secrets | Cloudflare dashboard | `wrangler secret put` | `BOT_TOKEN`, `GEMINI_API_KEY` |
| **Runtime** | KV `fredy:settings:<adminId>` | admin panel, **hot** | `language`, `categories.A.quota`, `sources.github.enabled` |

### 7.2 Section Registry (`src/core/config/sections/`)

15 registered sections, each versioned with its own Zod schema + defaults + optional `migrate()`:

| # | Section | Version | Key fields |
|---|---------|---------|------------|
| 1 | `general` | v1 | botEnabled, maintenanceMode, environment, timezone, channelName |
| 2 | `telegram` | v1 | targetChannel, adminId, footer, parseMode, disableWebPagePreview |
| 3 | `language` | v1 | default (auto/en/fa), supported, autoDetect |
| 4 | `scheduler` | **v2** | enabled, slots, jitterMinutes, timezone, postingWindows, quietHours, lockTimeoutSec, minGapMinutes, publishingMode, burstPosting, skipIfLowQuality, refreshIntervalMinutes |
| 5 | `categories` | v1 | A/B/C {enabled, dailyLimit, priority, weight, fallback}, rotationOrder, allowSameCategoryTwice |
| 6 | `ai` | v1 | primaryProvider, fallbackProvider, temperature, maxTokens, retryCount, promptProfile, qualityThreshold, timeoutMs |
| 7 | `providers` | v1 | gemini {models, dailyLimit}, openrouter {models, dailyLimit} |
| 8 | `content` | v1 | postsPerDay, categoryDistribution, randomOffsetMinutes, burstPosting, duplicatePrevention, duplicateTtlHours, sourceFooterFormat, emojiPool, queueMin/Target per category |
| 9 | `quality` | v1 | minScore, duplicateDetection, duplicateTtlHours, spamProtection, spamPatterns, minLength, maxLength, rejectEmptyOutput, rejectWrongLanguage, rejectBrokenHtml |
| 10 | `debug` | v1 | enabled, logLevel, simulationMode, verboseOutput, ringBufferCapacity |
| 11 | `logging` | v1 | kvWrites, consoleLevel, kvLevel, includeStackTrace, maxContextLength |
| 12 | `nasa` | v1 | dailyPost, captionLength, imagePreference, skipConsecutiveDays, includeVideoAsLink |
| 13 | `plugins` | v1 | defaultTimeoutMs, defaultRetryCount, defaultDailyLimit, perPlugin defaults |
| 14 | `future` | v1 | extensions (free-form experimental) |
| 15 | `strategy` | v1 | mode, customDistribution, weeklyThemesEnabled, language, qualityThreshold |

### 7.3 Config Caching Strategy

| Cache | Scope | TTL | Invalidation |
|-------|-------|-----|--------------|
| `sharedConfigCache` (settings) | module singleton | 30s | explicit `invalidate(adminId)` on writes |
| `stateCache` (state) | per-instance | 10s | `delete(key)` on `updateState()` |
| Soul cache | module-level | 60s | updated in-place on `save()` |
| Bot ID cache | module-level | permanent (per isolate) | none |
| Chat ID cache | module-level Map | permanent | `invalidateChatIdCache()` on demand |

### 7.4 Config vs. State Separation (audit-derived rule 21.3)

- **Config:** `fredy:settings:<adminId>` — rarely changes
- **State:** `fredy:state:<adminId>` — counters, lastPublishedAt, today's progress

This split avoids rewriting config on every stat bump and prevents races.

---

## 8. Existing Plugins

### 8.1 Plugin Contract (`src/core/plugin/`)

```typescript
interface Plugin {
  readonly metadata: PluginManifest;
  fetch(): Promise<readonly SourceItem[]>;
  normalize(raw: unknown): SourceItem;
  validate(item: SourceItem): boolean;
  supportsMedia(): boolean;
  getSource(): string;
  getCategory(): Category;
  health(): Promise<PluginStatus>;
}

interface PluginManifest {
  id: string; name: string; version: string;
  enabled: boolean; category: "A"|"B"|"C";
  priority: number;          // 1 = highest
  rateLimit: number;         // requests/hour, 0 = unlimited
  supportsImages: boolean;
  description?; author?; docsUrl?; homepage?;
  supportsMarkdown?; supportsLanguage?: readonly string[];
}
```

### 8.2 Plugin Validator (`src/core/plugin/validator.ts`)

- `validatePlugin(candidate)` — asserts Plugin interface; throws `PluginInterfaceError` with missing methods/fields
- Called at startup by `PluginManager.register()` and `PluginLoader.load()`
- `REQUIRED_METHODS = ["fetch","normalize","validate","supportsMedia","getSource","getCategory","health"]`
- `REQUIRED_MANIFEST_FIELDS = ["id","name","version","enabled","category","priority","rateLimit","supportsImages"]`

### 8.3 Plugin Manager (`src/services/plugin-manager.ts`)

- Register/unregister/enable/disable/reload
- `fetchForCategory(cat)` — anti-repeat: moves `lastSource` to end of candidates
- Health-check aggregation

### 8.4 AI Provider Registry (`src/services/provider-registry.ts`)

- Separate from content plugins
- `complete(request, preferredId?)` — sequential fallback over enabled providers sorted by priority
- Each attempt: `AbortController` + timeout (15s/30s)

### 8.5 Hook Engine (`src/services/hook-engine.ts`) — ⚠️ MISNOMER

**IMPORTANT:** Despite the name, this is NOT a lifecycle/event hook system. It's a **headline generator** — picks curiosity-inducing one-liners for posts. 4 strategies (category, insight, action, question) + 20-item in-memory dedup. **There is no plugin lifecycle hook system** (no `beforePublish`/`afterPublish`/`onQualityFail`). This is a v11 extension opportunity.

---

## 9. Existing Tests

### 9.1 Test Infrastructure

- **Framework:** `node:test` via `tsx` (no Jest/Vitest dependency)
- **Location:** `scripts/test-*.ts`
- **Total tests:** 137 (as of v9.3.1)

| Suite | File | Tests |
|-------|------|-------|
| Scheduler | `test-scheduler.ts` | 41 |
| Strategy | `test-strategy.ts` | 34 |
| Pipeline | `test-pipeline.ts` | 41 |
| Dedup | `test-dedup.ts` | 21 |

### 9.2 Test Scripts (`package.json`)

```json
"test": "tsx scripts/test-scheduler.ts && tsx scripts/test-strategy.ts && tsx scripts/test-pipeline.ts && tsx scripts/test-dedup.ts"
```

### 9.3 Coverage Gaps

- No tests for `src/entry/` (too thin, covered by integration)
- No tests for `src/admin/` screens (UI layer)
- No e2e tests (gated behind `RUN_E2E=true` env flag, not implemented)
- `test-units.ts` exists but is vestigial (references old structure)
- Plugin tests: only happy-path covered per plugin, no failure-path tests

---

## 10. Existing Deployment Flow

### 10.1 Prerequisites

1. Cloudflare account (free tier)
2. Telegram bot token from @BotFather
3. Google Gemini API key (15 RPM, 1,500/day free)
4. OpenRouter API key (20 RPM, free models)
5. Optional: NewsAPI, NASA API, GitHub tokens

### 10.2 Secrets (set via `wrangler secret put`)

**Required:** `ADMIN_ID`, `BOT_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CRON_KEY`
**Recommended:** `WEBHOOK_SECRET`, `DEBUG_TOKEN`
**Optional:** `NEWSAPI_KEY`, `NASA_API_KEY`, `GITHUB_TOKEN`

### 10.3 Deployment Steps

```bash
# 1. Install
bun install

# 2. Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put CRON_KEY
npx wrangler secret put ADMIN_ID

# 3. Deploy
npx wrangler deploy

# 4. Set webhook
./scripts/set-webhook.sh <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>

# 5. External cron (cron-job.org)
#    URL: https://<worker>.workers.dev/internal/tick?key=<CRON_KEY>
#    Schedule: every 2 hours
#    Timeout: 60s

# 6. Verify
npx tsx scripts/verify-setup.ts <WORKER_URL> <DEBUG_TOKEN>
```

### 10.4 KV Namespace

Single namespace `Fredy_SETTINGS` (ID: `5361932dda4544358b92e9341f3e77ef`). All keys prefixed with `fredy:`.

### 10.5 D1 (Optional, Analytics)

Commented out in `wrangler.toml`. Migration `0001_init.sql` exists. D1 is only for relational queries KV can't answer.

---

## 11. Known Technical Debt

### 11.1 High Priority

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **`manager.ts` is 1718 lines** — HTML-in-string dashboard | `src/entry/manager.ts` | Unmaintainable, hard to extend, no component reuse |
| 2 | **Two parallel config schema definitions** — section-registry (active) vs `core/schemas/settings.ts` (legacy, unused) | `src/core/schemas/settings.ts` | Drift, confusion, dead code |
| 3 | **AI "race" is actually sequential fallback** — no `Promise.race`/`Promise.any` | `src/services/fallback-handler.ts` | Higher latency than necessary; architecture docs claim racing |
| 4 | **`as never` casts (3 occurrences)** — type-safety bypasses | `content-manager.ts:241`, `admin/commands/start.ts:23`, `admin/commands/menu.ts:24` | Type safety holes |
| 5 | **Hook engine is misnamed** — generates headlines, not lifecycle hooks | `src/services/hook-engine.ts` | No plugin extension mechanism for pipeline events |

### 11.2 Medium Priority

| # | Issue | Location |
|---|-------|----------|
| 6 | `JobQueue` is partially dead code — only `list()` is used | `src/services/job-queue.ts` |
| 7 | Hardcoded cache TTLs per plugin — should be centralized in config | each `src/plugins/sources/*/index.ts` |
| 8 | `EnrichmentEngine` and `ContentEnricher` are separate with overlapping responsibilities | `src/services/` |
| 9 | TODO comments (4 remaining) | `source-formatter.ts`, `category-manager.ts`, `language-manager.ts`, `orchestrators/scheduler.ts` |
| 10 | `RetryHandler` is wired but never called by `AIService.generate()` | `src/services/ai-service.ts` |
| 11 | `test-units.ts` is vestigial | `scripts/test-units.ts` |
| 12 | `debug.ts` (350 lines) is legacy — superseded by `manager.ts` | `src/entry/debug.ts` |
| 13 | Some plugins return stub `health()` (always healthy) — only `news` actually checks env | most `src/plugins/sources/*/index.ts` |

### 11.3 Low Priority

| # | Issue |
|---|-------|
| 14 | Some empty catch blocks could log errors |
| 15 | `README.md` version badge still shows 7.1.0 (stale) |
| 16 | Reddit plugin disabled (needs OAuth migration) |
| 17 | No rate-limit awareness for Gemini/OpenRouter (no proactive backoff) |
| 18 | No uptime monitoring on `/internal/tick` |
| 19 | No queue-depth alerts (admin not notified if category queue < min for 2+ ticks) |

---

## 12. Potential Risks

### 12.1 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| External cron (cron-job.org) outage | Medium | High (no posts) | Internal 24h backup cron; stale-tick detection alerts admin |
| KV write budget exhaustion (1,000/day) | Low | Medium | Batched stats pattern (flush every 10); DEBUG_MODE gates KV logging |
| Gemini API quota exhaustion (1,500/day) | Low | Medium | OpenRouter fallback; sequential model fallback |
| Telegram webhook timeout (>60s) | Low | High | `ctx.waitUntil()` pattern; 90s pipeline timeout |
| Concurrent tick execution | Low | Medium | Distributed KV lock (`fredy:tick:lock`, 90s TTL) |
| False dedup positives (pre-v9.3.1) | **Fixed** | Was High | v9.3.1 moved recording to AFTER publish |

### 12.2 Architectural Risks

| Risk | Impact | Notes |
|------|--------|-------|
| **Single 1718-line `manager.ts`** | High | Any dashboard change risks breaking the whole file. No tests. Hard to review. |
| **No plugin lifecycle hooks** | Medium | Can't extend pipeline behavior without editing core |
| **Sequential AI fallback** | Medium | Latency = sum of all provider timeouts on total failure |
| **Config schema drift** | Low | Legacy schema unused but imports create confusion |
| **Single-admin model** | Low | `env.ADMIN_ID` string compare; no multi-admin/roles |

### 12.3 Security Risks

- ✅ All secrets via `wrangler secret put` (not in `wrangler.toml [vars]`)
- ✅ `maskValue()` used in debug output
- ✅ `escapeHtml()` on all Telegram output
- ✅ `CRON_KEY` / `DEBUG_TOKEN` / `WEBHOOK_SECRET` auth on endpoints
- ⚠️ `ADMIN_ID` is string compare (no timing-safe comparison — low risk for Telegram context)
- ⚠️ No CSRF protection on Manager dashboard POST endpoints (Bearer token only)

---

## 13. Optimization Opportunities

### 13.1 v11 Primary Refactor: Extract Dashboard to Next.js

**Current:** `manager.ts` (1718 lines) generates HTML strings inline, with ~35 API endpoints.
**Proposed:** Next.js 16 App Router dashboard (the current `/home/z/my-project` environment), consuming the Cloudflare Workers REST API.

**Benefits:**
- Component-based UI (shadcn/ui already available)
- Real-time updates (TanStack Query, SWR, or WebSocket)
- Type-safe API client (generated from Worker types)
- Proper routing, code-splitting, lazy loading
- Dark mode, responsive design, accessibility
- Preserves Worker backend as-is (no backend rewrite)

**Architecture:**
```
Next.js Dashboard (port 3000)  ──HTTP──►  Cloudflare Worker (fredy-admin)
  • shadcn/ui components                    • /Manager/api/* (existing REST)
  • TanStack Query                          • /internal/tick
  • NextAuth (optional)                     • /webhook
  • WebSocket (optional, for live logs)
```

### 13.2 AI True Parallel Racing

**Current:** Sequential per-model fallback (latency = sum of timeouts on failure).
**Proposed:** `Promise.any` with shared `AbortController` — first provider to succeed wins, others aborted.

**Expected improvement:** ~50% latency reduction on happy path; ~80% on first-provider success.

### 13.3 Plugin Lifecycle Hooks

**Current:** No extension mechanism for pipeline events.
**Proposed:** `beforePublish`, `afterPublish`, `onQualityFail`, `onSourceFetch` hooks. Plugins can register handlers.

### 13.4 Centralize Plugin Cache TTLs

**Current:** Each plugin has its own `CACHE_TTL_SECONDS` constant.
**Proposed:** Move to `plugins.perPlugin.<id>.cacheTtlMinutes` in config.

### 13.5 Consolidate Enrichment Modules

**Current:** `EnrichmentEngine` (pure) + `ContentEnricher` (API-fetching) — overlapping.
**Proposed:** Merge into one `EnrichmentService` with pure + fetch methods.

### 13.6 Real Rate-Limit Awareness

**Current:** No tracking of Gemini/OpenRouter remaining quota.
**Proposed:** Parse `X-RateLimit-Remaining` headers; proactive backoff; expose in dashboard.

### 13.7 Queue Depth Alerts

**Current:** No alert if category queue drops below minimum.
**Proposed:** Notify admin if any category queue < min for 2+ consecutive ticks.

### 13.8 Multi-Admin Support

**Current:** Single `env.ADMIN_ID`.
**Proposed:** `fredy:admins` KV list with roles (owner, editor, viewer).

---

## 14. Missing Documentation

### 14.1 Documented ✅
- `README.md` — overview, quick start, endpoints, architecture diagram
- `docs/ARCHITECTURE_RULES.md` — 692-line authoritative rules (22 sections)
- `docs/CONFIG_GUIDE.md` — configuration reference
- `docs/FREDY_GUIDELINES.md` — content formatting guidelines
- `docs/soul.md` — personality definition
- `DEPLOYMENT_GUIDE.md` — step-by-step deployment
- `DEPLOYMENT_CHECKLIST.md` — pre-deploy checklist
- `CHANGELOG.md` — 2734-line detailed history
- `FINAL_AUDIT_REPORT.md` — v7.1.0 audit (stale, needs refresh for v9.3.2)

### 14.2 Missing / Stale ❌
- **No v9.3.2 audit report** (FINAL_AUDIT_REPORT.md is from v7.1.0)
- **No API reference** for `/Manager/api/*` endpoints (35+ endpoints, only inline docs)
- **No plugin development guide** (how to write a new source plugin)
- **No decision records** (`docs/decisions/` folder mentioned in rules but doesn't exist)
- **No CONTRIBUTING.md**
- **No architecture diagram** (ASCII in README, no visual diagram)
- **README version badge stale** (shows 7.1.0, should be 9.3.2)
- **No WebSocket documentation** (if added in v11)
- **No dashboard user guide** (Manager dashboard has no end-user docs)

---

## 15. Compatibility Notes for v11

### 15.1 MUST Preserve (non-negotiable)

- **Cloudflare Workers runtime** — the backend stays on Workers (free tier)
- **Single KV namespace** (`Fredy_SETTINGS`) with `fredy:` prefix
- **Section-registry config system** — 15 sections, versioned, Zod-validated
- **Plugin contract** — `Plugin` and `AIProvider` interfaces unchanged
- **Pipeline order** — Provider → Filter → Dedup → Freshness → Rank → Enrich → AI → Quality → Queue → Publish
- **`ctx.waitUntil()` pattern** — return 200, work in background
- **Slot-based scheduling** with posting windows, jitter, quiet hours
- **Strategy engine** — 6 modes, weekly themes
- **soul.md** — personality definition, KV-overridable
- **Admin PM notifications** — every publish (success/failure) notifies admin
- **Telegram HTML formatting** — markdown→HTML conversion, blockquotes, expandable quotes

### 15.2 Safe to Refactor

- **`manager.ts` dashboard** → extract to Next.js (keep REST API on Worker)
- **`debug.ts`** → consolidate into Next.js dashboard or remove
- **AI fallback** → upgrade to true parallel racing
- **`hook-engine.ts`** → rename to `headline-generator.ts` AND/OR add real lifecycle hooks
- **Legacy config schema** (`core/schemas/settings.ts`) → remove dead code
- **`JobQueue`** → fully integrate or remove
- **`test-units.ts`** → remove
- **`as never` casts** → properly type

### 15.3 v11 Extension Points (new features)

- **Next.js Mission Control dashboard** (primary deliverable)
- **WebSocket** for real-time logs/pipeline events (mini-service on separate port)
- **Plugin lifecycle hooks** (`beforePublish`, `afterPublish`, `onQualityFail`)
- **Multi-admin support** (roles: owner, editor, viewer)
- **D1 analytics** (enable commented-out D1 for relational queries)
- **Rate-limit awareness** (parse headers, proactive backoff)
- **Queue depth alerts**
- **Uptime monitoring endpoint**

### 15.4 Breaking Changes to Avoid

- Do NOT change KV key patterns (would orphan existing data)
- Do NOT change `Plugin` / `AIProvider` interface signatures (would break plugins)
- Do NOT change `FredySettings` top-level shape (would break admin panel)
- Do NOT remove the `/internal/tick` endpoint (external cron depends on it)
- Do NOT change the webhook payload contract (Telegram → Worker)
- Section migrations MUST be additive (new fields with defaults)

### 15.5 v11 Versioning Plan

- `VERSION` → `11.0.0`
- `package.json` → `11.0.0`
- `src/core/constants.ts` → `APP_VERSION = "11.0.0"`
- Config `schema_version` stays at `1` (no schema change in v11 core)
- Section versions: bump individually only if their shape changes

---

## 16. Summary & Next Steps

### 16.1 Current State Assessment

Fredy v9.3.2 is a **production-ready, well-architected** system with one major pain point: the 1700-line HTML dashboard embedded in `manager.ts`. The backend (bot, scheduler, pipeline, plugins) is solid, tested (137 tests), and optimized for the Cloudflare free tier.

**Scores (updated from v7.1.0 audit):**
- Architecture Quality: 9/10
- Performance: 8/10
- Maintainability: 7/10 *(dragged down by `manager.ts`)*
- Security: 8/10
- Test Coverage: 7/10
- Documentation: 7/10
- **Overall: 8/10** — production-ready, refactor candidate for dashboard

### 16.2 Recommended v11 Roadmap

| Phase | Focus | Effort |
|-------|-------|--------|
| **v11.0** | Extract `manager.ts` → Next.js Mission Control dashboard | High |
| **v11.1** | AI true parallel racing + rate-limit awareness | Medium |
| **v11.2** | Plugin lifecycle hooks + headline-generator rename | Medium |
| **v11.3** | Consolidate enrichment + remove dead code | Low |
| **v11.4** | Multi-admin support + D1 analytics | Medium |
| **v11.5** | WebSocket real-time updates | Medium |

### 16.3 Awaiting Instructions

Per the bootstrap prompt: *"After the Report: Wait. Do NOT implement any change until explicitly instructed. Every future prompt should build on the uploaded codebase and this report."*

**No code changes have been made to the Fredy backend.** The v9.3.2 source has been copied to `/home/z/my-project/fredy-v11/` as the working baseline. The `VERSION` file is set to `11.0.0-dev` (staging marker).

Ready for the next prompt.

---

**End of `PROJECT_STATUS_REPORT.md`.**

# Fredy v11.6.0

> **Autonomous AI-powered content publishing platform for Telegram channels.**
> Built on Cloudflare Workers. Tier-based provider architecture. Free-tier optimized.

[![Version](https://img.shields.io/badge/version-11.6.0-blue)](./VERSION)
[![Runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-202%20passing-brightgreen)](./scripts)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Provider Tier System](#provider-tier-system)
- [Content Pipeline](#content-pipeline)
- [Scheduler](#scheduler)
- [Telegram Admin Bot](#telegram-admin-bot)
- [Manager Dashboard](#manager-dashboard)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

---

## Overview

Fredy is a serverless, AI-driven content publishing system for Telegram channels. It automatically fetches, curates, rewrites, and publishes developer-focused content to your Telegram channel — optimized for the Cloudflare Workers **Free Plan**.

### What Fredy Does

1. **Collects** content from 20+ providers (GitHub, Dev.to, Hacker News, NASA, Cloudflare Blog, etc.)
2. **Filters** low-quality content using per-provider quality rules (stars, score, votes, age)
3. **Enriches** content with metadata (GitHub stars, HN points, etc.)
4. **Rewrites** content using AI (Gemini/OpenRouter) with your channel's personality (soul.md)
5. **Schedules** posts at optimal times with jitter, quiet hours, and posting windows
6. **Publishes** to Telegram with images, HTML formatting, and source links
7. **Manages** everything from a web dashboard or Telegram bot

### Design Principles

- **Cloudflare Free Plan First** — every optimization respects free-tier limits (CPU, KV reads/writes, API calls)
- **Plugin Architecture** — add/remove providers without touching core code
- **Runtime Configuration** — all settings stored in KV, editable without redeployment
- **AI Minimization** — deterministic filters run BEFORE AI to save tokens
- **Observability** — full scheduler debug, provider analytics, admin PM notifications

---

## Key Features

### 20 Content Source Providers (4 Tiers)

| Tier | Refresh | Providers |
|------|---------|-----------|
| **S** (Core) | 2h | GitHub, GitHub Releases, GitHub Trending, GitHub Events, Dev.to, Hacker News (Algolia), NASA APOD |
| **A** (Important) | 6h | StackExchange, Cloudflare Blog, Hugging Face Blog, Product Hunt |
| **B** (Supporting) | 12h | XKCD, GitHub Security, OpenAI News, Reddit Programming |
| **Legacy** | 24h | News (NewsAPI), Joke, Wikimedia, Hacker News (Firebase), Reddit (old) |

### AI Engine

- **Google Gemini** (primary) — 6 models including gemini-3.5-flash
- **OpenRouter** (fallback) — 6 free models (Llama 3.3, Qwen3, Gemma 4, GPT-OSS, Hermes 3, Nemotron 3)
- **JSON repair** — automatically fixes malformed AI JSON responses (v11.4.0)
- **Format-only fallback** — when all AI fails, publishes cleaned raw content
- **Quality scoring** — 6-dimension quality evaluation (0-100)

### Scheduler

- **Slot-based** with posting windows (5 configurable windows)
- **Jitter** (±30min) for natural publishing times
- **Quiet hours** (00:00–07:30 default)
- **Grace period** (4h) for missed slots — recovers from cron gaps
- **Multi-slot firing** — fires ALL due slots per tick (v11.2.0 fix)
- **Crash recovery** — "publishing" marker prevents duplicate posts (v11.2.0)
- **Admin PM alerts** for missed slots, stale ticks, strategy changes

### Telegram Admin Bot

- **12 commands**: `/start`, `/menu`, `/tiers`, `/plan`, `/debug`, `/providers`, `/force`, `/stats`, `/health`, `/checkperms`, `/soul`, `/help`
- **16 inline screens** with toggle/stepper/choice keyboards
- **Command menu** registered with Telegram (appears in "/" autocomplete)
- **Bilingual** (Persian + English) admin UI

### Manager Dashboard (Web)

- 15 pages: Dashboard, Strategy, Post, Back-Test, Plugins, Queue, AI, Scheduler, **Scheduler Debug**, Statistics, Logs, Debug, Configuration, Settings, System
- Real-time scheduler state visibility
- Provider health monitoring
- Full JSON diagnostic reports

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Entry Points                                       │
│   webhook.ts · tick.ts · cron.ts · manager.ts · health.ts   │
│   Responsibility: parse request, dispatch, return 200.      │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Orchestrators                                      │
│   admin.ts (492 lines) · scheduler.ts                       │
│   Responsibility: compose services into workflows.          │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Services (57 files, ~12k LOC)                      │
│   ai-service · content-manager · scheduler-service          │
│   provider-engine · provider-rotation · breaking-content    │
│   final-publisher · telegram · quality-engine · +20 more    │
│   Responsibility: single-domain business logic.             │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: Primitives & Types                                 │
│   hash · time · strings · report · 16 type files            │
│   Responsibility: pure functions, types, validators.        │
└─────────────────────────────────────────────────────────────┘
```

### DI Container

`buildContainer(env): Container` — constructs 40+ services in 8 layers. Rebuilt per request (no global state except shared config cache).

### Storage

- **Single KV namespace** (`Fredy_SETTINGS`) with prefix-namespaced keys (`fredy:*`)
- **Config cache**: 30s in-memory TTL (reduces KV reads ~80%)
- **Batched stats**: in-memory counters, flushed every 10 increments
- **Source cache**: per-plugin KV cache (2h–24h TTL)

---

## Provider Tier System

v11.0 replaced the old Category-based scheduling with a **Tier-based** system:

- **Categories** (A/B/C) remain for **content classification** (Programming, News, Support)
- **Tiers** (S/A/B/Legacy) determine **scheduling priority** (refresh interval)

### Central Provider Config

All provider metadata lives in **one file**: [`src/core/providers.config.ts`](./src/core/providers.config.ts)

```typescript
{
  id: "github-releases",
  name: "GitHub Releases",
  tier: "S",
  category: "A",
  weight: 100,              // weighted-random selection
  refreshIntervalHours: 2,
  cacheTtlSeconds: 14400,
  credibility: 95,          // candidate ranking
  reputation: 100,          // quality scoring
  minStars: 0,
  minScore: 0,
  canBreak: true,           // can trigger breaking content
  popularityExempt: false,
  // ...
}
```

Adding a provider = edit ONE file. A structural test (`scripts/test-plugin-registry.ts`, 65 assertions) ensures no provider is missing.

### Adaptive Refresh

If a provider returns no useful content 3 times consecutively, its refresh interval backs off: 2h → 4h → 6h (capped). When quality content returns, the interval resets to normal.

### Provider Rotation

- No same provider in consecutive publish cycles
- No same provider until at least 2 other providers have published
- No same topic (content hash) within the recent window

### Breaking Content

One extra publish slot per 24h for exceptional content:
- GitHub Security: CVSS ≥ 9 (critical)
- Hacker News: score ≥ 500 (very high)
- GitHub Releases: repo ≥ 5000 stars (major)
- OpenAI News: model release

---

## Content Pipeline

```
Provider Fetch
    ↓
1. Normalize (SourceItem → StandardPost)
    ↓
2. Enrich (metadata — pure, no fetch)
    ↓
3. Tag (auto-assign ≤8 tags)
    ↓
4. Validate (structural: title, URL, category)
    ↓
5. Freshness Filter (news >48h, NASA >7d → reject)
    ↓
6. Dedup (URL hash + content hash, 30-day TTL)
    ↓
7. Content Enricher (live API: GitHub stars, HN score)
    ↓
8. Provider Quality Filter (per-provider thresholds)
    ↓
9. Candidate Ranking (7-factor local score, NO AI)
    ↓
AI Generate (prompt → fallback → parse → JSON repair)
    ↓
Quality Score (6-dimension weighted average)
    ↓
Format (build ReadyContent with footer + emoji)
    ↓
Enqueue (per-category FIFO, max 50, 24h TTL)
    ↓
Scheduler Tick (fire ALL due slots)
    ↓
Publish (sendPhoto/sendMessage → Telegram)
    ↓
History Record (90-day TTL)
```

### AI Cost Minimization

All deterministic filters run **BEFORE** the AI call:
1. Freshness filter (rejects stale → saves tokens)
2. Popularity filter (rejects low-engagement → saves tokens)
3. Candidate ranker (picks best candidate → only ONE AI call)
4. Content enricher (enriches WITHOUT AI → improves AI output)

---

## Scheduler

### Cron Triggers

- **External** (primary): cron-job.org calls `/internal/tick` every 2 hours
- **Internal** (backup): Cloudflare cron `0 0 * * *` every 24 hours

### Tick Lifecycle

```
1. Authenticate (CRON_KEY)
2. Acquire KV lock (fredy:tick:lock, 90s TTL)
3. Return 200 immediately (work runs in ctx.waitUntil)
4. [background] Provider Engine: refresh due providers (staggered, max 3)
5. [background] Scheduler: fire ALL due slots (v11.2.0)
6. [background] Queue: maintain min depth per category
7. [background] Flush batched stats
8. Release lock
```

### Missed Slot Recovery (v11.2.0)

If a slot's time falls between two ticks (e.g., slot at 10:37, ticks at 10:00 and 12:00), the 12:00 tick fires it (within 4h grace). If the gap exceeds 4h, the slot is marked "failed" and an admin PM is sent.

---

## Telegram Admin Bot

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + language selection + register command menu |
| `/menu` | Open admin dashboard (16 inline screens) |
| `/tiers` | View all 20 providers grouped by tier |
| `/plan` | View today's publishing plan with slot statuses |
| `/debug` | Scheduler debug summary (due slots, lock, last tick) |
| `/providers` | Quick provider health overview (empty/healthy) |
| `/force` | Force publish ONE post now (doesn't affect scheduler) |
| `/stats` | Quick stats summary |
| `/health` | System health check (secrets, KV, Telegram, AI) |
| `/checkperms` | Check bot permissions in target channel |
| `/soul` | View soul.md status |
| `/help` | List all commands |

### Screens (16 total)

`main` · `settings` · `categories` · `providers` · `ai` · `manual` · `schedule` · `soul` · `debug` · `stats` · `editor` · `language` · `strategy` · `tiers` · `plan` · `schedulerdebug`

---

## Manager Dashboard

Accessed at `https://<your-worker>.workers.dev/Manager?token=<DEBUG_TOKEN>`

### Pages

| Page | Purpose |
|------|---------|
| Dashboard | System overview, quick controls, global stats |
| Strategy | Strategy mode, weekly themes, daily plan |
| Post to Channel | Manual publish from any provider |
| Back-Test | 9-point system test + full checkup |
| Plugins | Provider health, enable/disable, test |
| Queue | Per-category queue depth, send-now |
| AI | Provider status, model list, per-model test |
| Scheduler | Config, daily plan, force-publish |
| **Scheduler Debug** | Real-time scheduler state (v11.2.0) |
| Statistics | 7-day publish history |
| Logs | Recent updates/errors |
| Debug | Runtime info, tick/pipeline logs |
| Configuration | Full settings JSON viewer |
| Settings | Runtime config editor |
| System | Clear dedup/queue/logs/cache, reset |

---

## Configuration

All configuration is stored in KV (`fredy:settings:<adminId>`) and editable at runtime via the dashboard or bot. No redeployment required.

### 16 Config Sections

`general` · `telegram` · `language` · `scheduler` · `categories` · `tiers` · `ai` · `providers` · `content` · `quality` · `debug` · `logging` · `nasa` · `plugins` · `future` · `strategy`

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `scheduler.postingWindows` | 08-10, 12-14, 16-18, 18-20, 20-22 | Publishing time windows |
| `scheduler.quietHours` | 00:00–07:30 | No-publish period |
| `scheduler.jitterMinutes` | 30 | Random offset per slot |
| `content.postsPerDay` | 4 | Posts per day (1-20) |
| `quality.minScore` | 60 | Minimum quality score (0-100) |
| `ai.primaryProvider` | gemini | Primary AI provider |
| `tiers.tierDefaults.S.refreshIntervalHours` | 2 | Tier S refresh interval |

### Secrets (via `wrangler secret put`)

**Required:** `ADMIN_ID`, `BOT_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CRON_KEY`
**Recommended:** `WEBHOOK_SECRET`, `DEBUG_TOKEN`
**Optional:** `NEWSAPI_KEY`, `NASA_API_KEY`, `GITHUB_TOKEN`, `PRODUCTHUNT_TOKEN`

---

## Deployment

### Prerequisites

- Cloudflare account (free tier works)
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Google Gemini API key from [AI Studio](https://aistudio.google.com/apikey)
- OpenRouter API key from [openrouter.ai](https://openrouter.ai/keys)

### Quick Start

```bash
# 1. Clone and install
git clone https://github.com/ILIV007/Fredy-admin.git
cd Fredy-admin
bun install

# 2. Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put CRON_KEY
npx wrangler secret put ADMIN_ID
npx wrangler secret put GITHUB_TOKEN        # recommended (higher rate limit)
npx wrangler secret put PRODUCTHUNT_TOKEN   # optional (for API access)

# 3. Deploy
npx wrangler deploy

# 4. Set webhook
./scripts/set-webhook.sh <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>

# 5. Start the bot in Telegram
# Send /start to your bot — it will register the command menu automatically.
```

### External Cron Setup

1. Go to [cron-job.org](https://cron-job.org)
2. Create a job with URL: `https://<your-worker>.workers.dev/internal/tick?key=<CRON_KEY>`
3. Schedule: every 2 hours
4. Timeout: 60 seconds

---

## API Reference

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | Public | Health check |
| `/version` | GET | Public | Version info |
| `/health` | GET | Public | Detailed system status |
| `/Manager` | GET | DEBUG_TOKEN | Web dashboard |
| `/Manager/api/*` | GET/POST | DEBUG_TOKEN | Dashboard API (~40 endpoints) |
| `/Manager/api/scheduler/debug` | GET | DEBUG_TOKEN | Real-time scheduler state (v11.2.0) |
| `/internal/tick` | GET/POST | CRON_KEY | Cron trigger |
| `/webhook` | POST | WEBHOOK_SECRET | Telegram updates |

---

## Testing

```bash
# Run all tests
bun run test

# Individual test suites
bun run test:scheduler      # 41 scheduler tests
bun run test:strategy       # 34 strategy tests
bun run test:pipeline       # 41 pipeline tests
bun run test:dedup          # 21 dedup tests
bun run test:registry       # 65 plugin registry tests (v11.1.0)
```

**Total: 202 tests passing.**

---

## Troubleshooting

### Posts not publishing

1. Check `/debug` command — are slots "due" but not firing?
2. Check `telegram.adminId` is set (not empty) — `/health` shows it
3. Check scheduler is enabled and bot is enabled
4. Check quiet hours are not active
5. Check KV lock is not stuck (Manager → Scheduler Debug → Lock)

### Plugins returning 0 items

1. `stackexchange` — API may be throttled (shared CF IPs). Retries 3 tag sets.
2. `producthunt` — Without `PRODUCTHUNT_TOKEN`, uses RSS fallback.
3. `github-events` — Without `GITHUB_TOKEN`, rate limit is 60/hour. Set the token.
4. `reddit-v2` — Reddit blocks CF Workers. RSS fallback is used.
5. Clear source caches: Manager → System → "Clear Source Caches"

### AI quality score too low

1. Check AI providers are configured: `/health`
2. Check `ai.qualityThreshold` (default 60) — may need lowering
3. JSON repair (v11.4.0) fixes most AI parse errors automatically
4. Format-only fallback publishes raw content with score=1

### Duplicate posts

- v11.2.0 fixed this with "publishing" marker (written BEFORE publish)
- If duplicates persist, check that `force-publish` is not calling `scheduler.tick()`

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full history.

### v11.6.0 (Current)
- Global Provider Footer Refactor: every provider supplies its own displayIcon + displaySource
- GitHub posts show "🐙 owner/repo" (e.g., "🐙 microsoft/vscode")
- Non-GitHub posts show provider-specific label (e.g., "☁️ Cloudflare Blog", "🤗 Hugging Face")
- Future-proof: adding providers requires NO formatter changes
- Unified data flow: manifest → SourceItem → StandardPost → ContentItem → ReadyContent → FinalPost

### v11.5.0
- CRITICAL: Tick pipeline reordered — scheduler.tick() runs FIRST (was being killed by 30s timeout)
- RSS fallback for stackexchange (API throttles CF Workers)
- Search API fallback for github-events
- GitHub source formatting (later superseded by v11.6.0 unified system)

### v11.4.0
- FIX: Double-publish bug (manual force no longer calls scheduler.tick)
- FIX: Missing images (better og:image resolution, Dev.to API, browser UA)
- FIX: AI JSON parse errors (automatic JSON repair)
- FIX: stackexchange filter param removed (was causing 400)
- FIX: producthunt RSS fallback with multiple URLs
- NEW: setMyCommands (commands appear in Telegram "/" menu)
- NEW: Manual Post screen with all 20 providers organized by tier
- NEW: Professional README.md

### v11.3.0
- Plugin fixes: stackexchange, producthunt, github-events, reddit-v2
- telegram.adminId sync from env
- 3 new bot screens: tiers, plan, schedulerdebug
- 5 new bot commands: /tiers, /plan, /debug, /providers, /force

### v11.2.0
- CRITICAL: Scheduler fires ALL due slots (was only first)
- CRITICAL: Grace period 3h→4h
- CRITICAL: "publishing" marker before publish (crash recovery)
- force-publish acquires lock
- Strategy-change clears both plans + markers
- Stale-tick threshold 5h→3h
- Admin PM on grace failure
- Scheduler Debug dashboard page

### v11.1.0
- ProviderEngine wired into tick pipeline
- Central providers.config.ts (single source of truth)
- Provider Rotation + Breaking Content
- Updated Weekly Themes
- Plugin registry structural test (65 assertions)

### v11.0.0
- Tier-Based Provider Architecture (S/A/B/Legacy)
- 8 new plugins (github-events, hackernews-algolia, cloudflare-blog, etc.)
- Provider Quality Filters (per-provider)
- ProviderEngine (adaptive refresh, staggered scheduling)

---

## License

MIT — See [LICENSE](./LICENSE)

---

## Links

- **Repository:** [github.com/ILIV007/Fredy-admin](https://github.com/ILIV007/Fredy-admin)
- **Channel:** [@ILIVIR3](https://t.me/ILIVIR3)
- **Bot:** [@Fredy_IVbot](https://t.me/Fredy_IVbot)
- **Docs:** [ARCHITECTURE_RULES.md](./docs/ARCHITECTURE_RULES.md) · [CONFIG_GUIDE.md](./docs/CONFIG_GUIDE.md) · [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

**Fredy v11.4.0** — Built with ❤️ for the ILIVIR3 community.

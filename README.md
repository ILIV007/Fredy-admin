# Fredy v12.1.0

> **Autonomous AI-powered content publishing platform for Telegram channels.**
> Built on Cloudflare Workers Free Tier. Three-Layer Cron + Random Jitter + Tier V Scheduled Content.

[![Version](https://img.shields.io/badge/version-12.1.0-blue)](./VERSION)
[![Runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-208%20passing-brightgreen)](./scripts)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Three-Layer Cron System](#three-layer-cron-system)
- [Provider Tiers](#provider-tiers)
- [AI Models](#ai-models)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Telegram Bot Commands](#telegram-bot-commands)
- [Manager Dashboard](#manager-dashboard)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

Fredy is a production-ready, serverless content automation platform that publishes high-quality, AI-curated developer content to Telegram channels. It runs entirely on Cloudflare Workers Free Tier with zero infrastructure cost.

**What Fredy does:**
- Fetches content from 20+ providers (GitHub, Dev.to, Hacker News, NASA, Reddit, etc.)
- Filters by quality (popularity, freshness, stars, score)
- Rewrites with AI (Gemini / OpenRouter) in Persian or English
- Publishes to Telegram with images, smart link previews, and professional formatting
- Detects duplicates using a 3-layer system (canonical ID + URL + content hash)
- Schedules posts with human-like random jitter within configurable windows

**What makes Fredy special:**
- **Three-Layer Cron Architecture** — Cloudflare Cron for time-critical operations, external cron for background tasks
- **Random Jitter Scheduling** — posts publish at random times within windows (not fixed slots), mimicking human behavior
- **Zero-KV Quiet Hours** — during quiet hours, the scheduler consumes 0 KV operations
- **Tier V Scheduled Content** — fixed-schedule posts (NASA APOD nightly) alongside random-jitter posts
- **Duplicate Replacement Pipeline** — when a post is rejected as duplicate, Fredy automatically searches for a replacement (up to 5 attempts)
- **Provider Variety** — no provider appears more than twice per day + 1 wildcard slot from all APIs

---

## Key Features

### Scheduler
- **Window-Based Scheduling** — posts belong to posting windows (08-10, 12-14, 16-18, 18-20, 20-22)
- **EXACT Random Jitter** — `scheduledTime` is the real publish trigger (no tolerance, no early publishing)
- **20-Minute Watcher** — Cloudflare Cron checks every 20 minutes for due posts
- **Zero-KV Quiet Hours** — 0 reads, 0 writes during configurable quiet hours (default 00:00-07:30)
- **Provider Smart Sleep** — Layer 2 skips refresh when queues are full during quiet hours

### Content Pipeline
- **20 Content Providers** — GitHub (trending, releases, events, security), Dev.to, Hacker News, NASA, Reddit, StackExchange, Cloudflare Blog, Product Hunt, XKCD, and more
- **3-Layer Dedup** — canonical ID (provider:stableId) + normalized URL + content hash (URL+title)
- **Quality Scoring** — 6-dimension quality engine (credibility, popularity, freshness, relevance, diversity, language)
- **AI Rewrite** — Gemini 3.6-flash (primary) + OpenRouter fallback (nemotron-3-ultra, qwen3-coder, gpt-oss-20b)
- **Image Resolution** — unified pipeline: provider image → GitHub social preview → og:image → twitter:image
- **Smart Link Preview** — disabled/smart/always modes with per-provider configuration

### Duplicate Replacement
- When a post is rejected as duplicate, Fredy searches for a replacement from the **same category**
- Up to 5 attempts before marking the slot as failed
- Slot integrity preserved (window, scheduledTime, category never modified)
- Admin notified with full list of rejected candidates

### Tier V — Scheduled Content
- Fixed-schedule posts that don't use random jitter or category queues
- NASA APOD publishes nightly at 23:00 (configurable)
- Extensible: weekly reports, monthly summaries, community posts
- Uses the same publishing pipeline (dedup → AI → image → Telegram → history)

### Telegram Bot
- 16 screens, 12 commands
- Inline keyboards for all interactions
- Daily plan viewer with Window | Scheduled | Status format
- Provider management, AI testing, queue monitoring
- Admin PM notifications (exact channel post copy + summary report)

---

## Architecture

```
                    Fredy Worker
                 (Cloudflare Workers)

    ┌─────────────────────────────────────────┐
    │              Cloudflare Cron             │
    │                                         │
    │  */20 * * * *  → Layer 1: Watcher       │
    │                   (check due → publish)  │
    │                                         │
    │  0 0 * * *     → Layer 3: Maintenance   │
    │                   (generate plan, cleanup)│
    └─────────────────────────────────────────┘

    ┌─────────────────────────────────────────┐
    │          External Cron (cron-job.org)    │
    │                                         │
    │  Every 2h → GET /internal/provider-refresh│
    │              → Layer 2: Provider Refresh  │
    │                (fetch content, queues)    │
    └─────────────────────────────────────────┘

    KV Usage: ~153 reads/day, ~68 writes/day
    (0.15% of 100K reads, 6.8% of 1K writes)
```

### Publishing Flow

```
Scheduled Slot Due
        ↓
Acquire Candidate (same category)
        ↓
Publish (dedup → AI → image → Telegram)
        ↓
  ┌─ Success → mark published, notify admin
  │
  └─ Duplicate → search replacement (up to 5 attempts)
       ↓
  ┌─ Replacement found → publish replacement
  │
  └─ All 5 duplicates → NO_VALID_CONTENT_AFTER_DEDUP
       ↓
  Notify admin with rejected candidates list
```

---

## Three-Layer Cron System

| Layer | Schedule | Source | Responsibility | KV/tick |
|-------|----------|--------|---------------|---------|
| 1 — Scheduler Watcher | every 20 min | Cloudflare Cron | Check due posts → publish | 0 writes (no-due path) |
| 2 — Provider Refresh | every 2h | External (cron-job.org) | Fetch content, maintain queues | ~3 writes |
| 3 — Daily Maintenance | every 24h | Cloudflare Cron | Generate plan, cleanup KV | ~10 writes |

**Layer 1** is the only trigger that publishes posts. It checks `scheduledTime` (EXACT, no tolerance) and fires on the first tick at or after it. Expected delay: 0-20 minutes.

**Layer 2** is triggered externally via `GET /internal/provider-refresh?key=<CRON_KEY>`. It fetches content from providers, maintains queue depth, and applies adaptive backoff. Smart Sleep: skips entirely if quiet hours AND all queues are full.

**Layer 3** generates tomorrow's daily plan with fresh random `scheduledTime` per window, cleans expired KV data, and resets daily counters.

---

## Provider Tiers

| Tier | Refresh | Description | Providers |
|------|---------|-------------|-----------|
| 🥇 S | 2h | Core providers | GitHub Trending, GitHub Releases, GitHub Topic Search, GitHub Discovery, Dev.to, Hacker News |
| 🥈 A | 6h | Important providers | StackExchange, Cloudflare Blog, Hugging Face Blog, Product Hunt |
| 🥉 B | 12h | Supporting providers | XKCD, Reddit Programming, GitHub Security, OpenAI News |
| 📦 Legacy | 24h | Disabled by default | Hacker News (Firebase), NewsAPI, Joke API, Wikimedia, Reddit (OAuth) |
| 🟣 V | On-demand | Scheduled content | NASA APOD (nightly 23:00) |

---

## AI Models

### Gemini (Primary)
1. `gemini-3.6-flash` — newest free-tier Flash
2. `gemini-3.5-flash` — best overall, 1M context
3. `gemini-3.1-flash-lite` — fastest lite
4. `gemini-3-flash` — stable flash
5. `gemini-2.5-flash` — legacy reliable
6. `gemini-2.5-flash-lite` — legacy lite

### OpenRouter (Fallback)
1. `nvidia/nemotron-3-ultra-550b-a55b:free`
2. `qwen/qwen3-coder:free`
3. `nvidia/nemotron-3-super-120b-a12b:free`
4. `google/gemma-4-31b-it:free`
5. `openai/gpt-oss-20b:free`
6. `meta-llama/llama-3.3-70b-instruct:free`

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/)
- [Cloudflare account](https://dash.cloudflare.com/sign-up/workers) (Free tier is sufficient)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- A Gemini API Key (from [Google AI Studio](https://aistudio.google.com/apikey))
- Optional: OpenRouter API Key, GitHub Token, NASA API Key, NewsAPI Key

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/fredy.git
cd fredy

# Install dependencies
bun install  # or npm install

# Login to Cloudflare
wrangler login

# Set up secrets
wrangler secret put BOT_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put CRON_KEY
wrangler secret put ADMIN_ID
wrangler secret put DEBUG_TOKEN

# Optional secrets
wrangler secret put OPENROUTER_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put NASA_API_KEY
wrangler secret put NEWSAPI_KEY
wrangler secret put WEBHOOK_SECRET
```

### Local Development

```bash
# Create .dev.vars with your secrets
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your values

# Start local dev server
bun run dev  # or wrangler dev
```

### Deployment

```bash
# Deploy to Cloudflare Workers
bun run deploy  # or wrangler deploy

# Set up the webhook
bash scripts/set-webhook.sh

# Set up external cron (cron-job.org)
# URL: https://your-worker.workers.dev/internal/provider-refresh?key=YOUR_CRON_KEY
# Schedule: Every 2 hours
```

---

## Configuration

All configuration is stored in Cloudflare KV and can be changed at runtime via the Manager Dashboard or Telegram Bot — no redeployment required.

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `scheduler.enabled` | true | Enable/disable the scheduler |
| `scheduler.timezone` | Asia/Tehran | Timezone for scheduling |
| `scheduler.postingWindows` | 5 windows | Posting windows (08-10, 12-14, 16-18, 18-20, 20-22) |
| `scheduler.quietHours` | 00:00-07:30 | No publishing during this period |
| `scheduler.minGapMinutes` | 90 | Minimum gap between posts |
| `content.postsPerDay` | 5 | Total posts per day |
| `ai.primaryProvider` | gemini | Primary AI provider |
| `ai.qualityThreshold` | 80 | Minimum quality score |
| `telegram.linkPreviewMode` | smart | Link preview mode |
| `tierV.entries` | NASA 23:00 | Tier V scheduled content |

---

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot + show main menu |
| `/status` | System status overview |
| `/plan` | View today's daily plan |
| `/stats` | Publishing statistics |
| `/queue` | Content queue depths |
| `/plugins` | Provider list + toggle |
| `/tiers` | Provider tier overview |
| `/ai` | AI provider settings |
| `/settings` | Bot settings |
| `/help` | Help + command list |
| `/health` | Health check |
| `/config` | Configuration viewer |

---

## Manager Dashboard

Access at: `https://your-worker.workers.dev/Manager` (protected by DEBUG_TOKEN)

### Pages

| Page | Description |
|------|-------------|
| Dashboard | Live clock, health gauge, next-publish countdown, recent activity feed |
| Strategy | Active strategy, weekly schedule overview, daily plan, Tier V entries |
| Post to Channel | Manual publish by provider (grouped by tier) |
| Scheduler | Scheduler controls, daily plan table, posting windows |
| Scheduler Debug | Real-time scheduler state, quiet hours, cron architecture |
| Statistics | 7-day heatmap, category donut, plugin bars, quality distribution |
| Plugins | Provider management, health, fetch testing |
| Queue | Content queue viewer |
| AI | AI model list, token usage, model testing |
| Logs | Publish failures, errors, debug ring buffer |
| Settings | Full configuration editor |
| System | System info, KV test, cache stats |

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | None | Health check |
| `/health` | GET | None | Detailed system status |
| `/version` | GET | None | Version info |
| `/internal/tick` | GET/POST | CRON_KEY | Manual scheduler trigger |
| `/internal/provider-refresh` | GET | CRON_KEY | External provider refresh (cron-job.org) |
| `/Manager` | GET | DEBUG_TOKEN | Manager dashboard |
| `/Manager/api/*` | GET/POST | DEBUG_TOKEN | Dashboard API |
| `/webhook` | POST | WEBHOOK_SECRET | Telegram webhook |
| `/debug/*` | GET | DEBUG_TOKEN | Legacy debug dashboard |

---

## Testing

```bash
# Run all tests
bun run test

# Run individual test suites
bun run test:scheduler    # Scheduler, TimeGenerator, QuietHours, Tier V
bun run test:dedup        # Duplicate detection (3-layer)
bun run test:strategy     # Strategy engine, themes, distribution
bun run test:registry     # Plugin registry consistency

# Type checking
bun run typecheck         # tsc --noEmit
```

**Test Results:** 208 tests passing (86 scheduler + 19 dedup + 38 strategy + 65 registry)

---

## Deployment

### Cloudflare Workers Free Tier Limits

| Resource | Free Limit | Fredy Usage |
|----------|-----------|-------------|
| Requests/day | 100,000 | ~85/day |
| KV Reads/day | 100,000 | ~153/day |
| KV Writes/day | 1,000 | ~68/day |
| Cron Triggers | 5 | 2 (Cloudflare) + 1 (external) |
| Worker Size | 1 MB | ~630 KB |
| CPU Time | 10ms | <30ms per tick |

### External Cron Setup (cron-job.org)

1. Create an account at [cron-job.org](https://cron-job.org)
2. Create a new job:
   - **URL:** `https://your-worker.workers.dev/internal/provider-refresh?key=YOUR_CRON_KEY`
   - **Schedule:** Every 2 hours
   - **Method:** GET
3. Enable "Alert me if this job doesn't run" for failure detection

### Webhook Setup

```bash
# Set the Telegram webhook
bash scripts/set-webhook.sh

# Or manually:
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-worker.workers.dev/webhook&secret_token=<WEBHOOK_SECRET>"
```

---

## Project Structure

```
fredy/
├── src/
│   ├── index.ts                 # Worker entry point (fetch + scheduled handlers)
│   ├── container.ts             # DI container (wires all services)
│   ├── entry/                   # HTTP/cron entry handlers
│   │   ├── cron.ts              # Cron router (Layer 1 + Layer 3)
│   │   ├── cron-scheduler.ts    # Layer 1: 20-min scheduler watcher
│   │   ├── cron-providers.ts    # Layer 2: provider refresh (external cron)
│   │   ├── cron-maintenance.ts  # Layer 3: daily maintenance
│   │   ├── provider-refresh.ts  # External endpoint for Layer 2
│   │   ├── tick.ts              # Manual trigger endpoint
│   │   ├── manager.ts           # Manager dashboard (HTML + API)
│   │   ├── webhook.ts           # Telegram webhook handler
│   │   ├── health.ts            # Health check endpoints
│   │   └── debug.ts             # Legacy debug dashboard
│   ├── services/                # Core services (40+ files)
│   │   ├── scheduler-service.ts # Scheduler + replacement pipeline
│   │   ├── strategy-engine.ts   # Daily plan generation
│   │   ├── time-generator.ts    # Random jitter slot generation
│   │   ├── content-manager.ts   # Content pipeline orchestrator
│   │   ├── final-publisher.ts   # Publishing pipeline (dedup → AI → Telegram)
│   │   ├── duplicate-detector.ts# 3-layer dedup (canonical + URL + hash)
│   │   ├── image-resolver.ts    # Unified image resolution
│   │   ├── provider-engine.ts   # Tier-based provider management
│   │   ├── quiet-hours-checker.ts# Quiet hours detection
│   │   ├── tier-v-scheduler.ts  # Tier V fixed-schedule content
│   │   └── ...                  # AI, media, queue, history, config, etc.
│   ├── plugins/                 # Content source plugins
│   │   ├── ai/                  # AI providers (Gemini, OpenRouter)
│   │   └── sources/             # 20+ content source plugins
│   ├── admin/                   # Telegram bot admin interface
│   │   ├── commands/            # Bot commands (/plan, /status, etc.)
│   │   └── screens/             # Bot inline screens
│   ├── core/                    # Configuration, constants, providers config
│   ├── types/                   # TypeScript type definitions
│   ├── primitives/              # Utility functions (strings, time, hash)
│   └── orchestrators/           # Thin wrappers (scheduler, etc.)
├── scripts/                     # Test + deployment scripts
├── migrations/                  # D1 database migrations (optional)
├── wrangler.toml                # Cloudflare Workers config
├── package.json                 # Dependencies + scripts
├── tsconfig.json                # TypeScript config
└── README.md                    # This file
```

---

## License

[MIT](./LICENSE) — Free to use, modify, and distribute.

---

## Credits

- **AI:** Google Gemini, OpenRouter
- **Platform:** Cloudflare Workers
- **Content Sources:** GitHub API, Dev.to API, Hacker News Algolia API, NASA APOD API, Reddit JSON API, StackExchange API, Product Hunt API, and more
- **External Cron:** cron-job.org

---

*Fredy v12.1.0 — Production-ready autonomous content publishing. Built for Cloudflare Workers Free Tier.*

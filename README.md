# Fredy v13.0.9

> **Autonomous AI-powered Technology News Hub for Telegram channels.**
> Built on Cloudflare Workers Free Tier. Tier H Hardware Headlines + Quality Filter + Novelty Score + Random Window Shuffling.

[![Version](https://img.shields.io/badge/version-13.0.9-blue)](./VERSION)
[![Runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-481%20passing-brightgreen)](./scripts)

---

## Overview

Fredy is a production-grade, serverless content publishing platform that automatically fetches, processes, and publishes high-quality technology news to Telegram channels. It evolved from a Developer Content Bot into a complete **Technology News Hub** with the introduction of Tier H (Hardware & Technology Headlines).

### What Makes Fredy Different

- **23 Content Source Providers** across 5 tiers (S/A/B/H/V) — RSS, REST API, GraphQL, JSON
- **Tier H Hardware News** — Ars Technica, Tom's Hardware, TechPowerUp with Quality Filter (0-100 scoring, threshold 70)
- **Novelty Score** — prevents same news from different providers being published within 48h
- **Truly Random Wildcard** — daily wildcard post picks from ALL 17 active APIs with zero filter
- **Random Window Shuffling** — posting windows shuffle daily, no permanent gaps
- **6 AI Models** — Gemini (primary) + OpenRouter (fallback, 6 free models)
- **Zero API Keys Required** for basic operation (GitHub, Dev.to, HackerNews, StackExchange, RSS feeds)
- **481 Passing Tests** across 7 test suites

---

## Key Features

### Content Sources (23 providers)

| Tier | Providers | Refresh | Type |
|------|-----------|---------|------|
| S (Core) | GitHub, GitHub Releases, GitHub Trending, GitHub Events, Dev.to, HackerNews (Algolia) | 2h | API |
| A (Important) | Stack Overflow, Cloudflare Blog, Hugging Face Blog, Product Hunt | 4h | RSS/API |
| B (Supporting) | XKCD, Reddit, GitHub Security, OpenAI News | 6h | RSS/API |
| H (Hardware) | Ars Technica, Tom's Hardware, TechPowerUp | 4h | RSS |
| V (Scheduled) | NASA APOD | Nightly 23:00 | API |
| Legacy | AnandTech, Reddit (old), HackerNews (old), News, Joke, Wikimedia | — | Disabled |

### Tier H Quality Filter

Every Tier H article receives a quality score (0-100) BEFORE entering the AI pipeline:

- **Positive signals** (+15 each): RTX, Ryzen, Apple Silicon, benchmark, AI hardware, TSMC, DDR5, PCIe Gen5, etc.
- **Negative signals** (-15 each): minor driver, buying guide, opinion, firmware patch, deal, etc.
- **Recent bonus** (+10): article <24h old
- **Launch word bonus** (+10): title contains "announced", "released", "launch"
- **Trend bonus** (+20): multiple providers covering same event
- **Clickbait penalty** (-25): "Everything you need to know...", "Best..."

Default threshold: **70** (configurable 50-90).

### Novelty Score

Prevents same NEWS from different providers:
- Extracts hardware product names (RTX 5090, Ryzen 9, M4 Ultra) as "trend keys"
- KV-backed tracking with 48h TTL
- If same trend key already published → rejected (unless quality is 15+ points higher)
- Different from Dedup: Dedup blocks same article (URL/hash). Novelty blocks same NEWS.

### Strategy Modes

| Mode | A/B/C Posts | Tier H Posts | Total |
|------|-------------|--------------|-------|
| Minimal | 4 | 0 | 4 |
| Conservative | 9 | 0 (every 2 days) | 9 |
| Balanced (default) | 9 | +1 | 10 |
| Active | 13 | +2 | 15 |
| Aggressive | 13 | +3 | 16 |
| Turbo | 13 | +4 | 17 |

All H-posts-per-mode values are **fully configurable** from the Manager — no redeploy needed.

### Random Window Shuffling

- 8 posting windows cover the full day (08:00-22:00)
- Windows are **shuffled** each day — no permanent gaps
- Multiple posts can share a window when post count > window count
- MinGap enforced between posts (default 90 min)

---

## Architecture

```
Layer 4 (Entry)    → src/entry/ — HTTP handler, cron triggers, Manager dashboard
Layer 3 (Orchestrators) → src/orchestrators/ — Admin, Scheduler
Layer 2 (Services)  → src/services/ — 54 files, ~11k LOC
Layer 1 (Primitives) → src/primitives/, src/types/ — Pure functions, types
```

### Content Pipeline (15 stages)

```
Fetch → Normalize → Enrich → Tag → Validate → Freshness → Dedup
→ ContentEnricher → CategoryResolve → Tier H Filter → Novelty Score
→ CandidateRanker → AI Generate → Quality Score → Format → Enqueue
```

### Three-Layer Cron

1. **Layer 1** (Cloudflare Cron, every 20 min): Tick + publish due slots
2. **Layer 2** (External cron-job.org, every 2h): Provider refresh + queue maintenance
3. **Layer 3** (Cloudflare Cron, daily midnight): Cleanup + stats

---

## Getting Started

### Prerequisites

- Cloudflare Workers account (Free tier works)
- Telegram Bot Token (via @BotFather)
- Gemini API Key (free tier: 15 RPM, 1,500/day)
- Optional: OpenRouter API Key (free models available)

### Installation

```bash
# Clone the repository
git clone https://github.com/ilivir3/fredy.git
cd fredy

# Install dependencies
bun install

# Configure secrets
cp .env.example .env
# Edit .env with your BOT_TOKEN, GEMINI_API_KEY, etc.

# Push schema to database
bun run db:push

# Run tests
bun run test

# Deploy to Cloudflare Workers
wrangler deploy
```

---

## Configuration

All configuration is stored in Cloudflare KV and editable via the Manager dashboard or Telegram bot — **no redeploy needed**.

### Key Settings

- **Strategy**: mode (balanced/active/turbo/etc), weekly themes, language
- **Scheduler**: posting windows, quiet hours, timezone, min gap
- **Categories**: enable/disable per category, daily limits, weights
- **Tier H**: enabled, threshold, extra H posts per mode, cooldown, retry count
- **AI**: provider (Gemini/OpenRouter), model, quality threshold, timeout
- **Telegram**: target channel, parse mode, link preview mode

---

## Telegram Bot Commands

```
/start     — Register as admin
/menu      — Main menu (inline keyboard)
/plan      — View today's publishing plan
/stats     — View publishing statistics
/tiers     — View all providers grouped by tier
/help      — Help
```

---

## Manager Dashboard

Access via your Worker URL: `https://your-worker.workers.dev/Manager`

Features:
- **Dashboard**: real-time metrics, queue depth, provider health
- **Strategy**: switch modes, view weekly schedule, regenerate plan
- **Scheduler**: view daily plan (sorted by time), fire next slot, debug
- **Post to Channel**: manual publish from any provider (Tier S/A/B/H/V)
- **Plugins**: enable/disable providers, view health + last fetch
- **Statistics**: 7-day charts, category distribution, quality scores, heatmap
- **Debug**: runtime config, tick logs, pipeline logs, dedup diagnostics
- **Settings**: all configuration sections

---

## Testing

```bash
# Run all 7 test suites (481 tests)
bun run test

# Individual suites
bun run test:scheduler     # 87 tests — time generation, slot firing
bun run test:strategy      # 203 tests — plan generation, themes, wildcard
bun run test:pipeline      # 41 tests — content pipeline
bun run test:dedup         # 19 tests — duplicate detection
bun run test:registry      # 65 tests — provider config consistency
bun run test:tier-h        # 40 tests — Tier H quality filter
bun run test:novelty       # 26 tests — Novelty score
```

---

## Deployment

```bash
# Set secrets
wrangler secret put BOT_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put ADMIN_ID
wrangler secret put CRON_KEY

# Deploy
wrangler deploy

# Set up external cron (cron-job.org)
# URL: https://your-worker.workers.dev/internal/provider-refresh?key=YOUR_CRON_KEY
# Every 2 hours
```

---

## Project Structure

```
Fredy-admin/
├── src/
│   ├── entry/           # HTTP handlers (manager, tick, cron, webhook)
│   ├── orchestrators/    # Admin + Scheduler orchestrators
│   ├── services/         # 54 service files (~11k LOC)
│   ├── plugins/
│   │   ├── sources/      # 23 content source plugins
│   │   └── ai/           # 2 AI providers (Gemini, OpenRouter)
│   ├── admin/            # Telegram bot screens + commands
│   ├── core/             # Config, constants, providers config
│   ├── types/            # TypeScript type definitions
│   └── primitives/       # Pure utility functions
├── scripts/              # Test suites + packaging
├── docs/                 # Architecture docs
├── wrangler.toml         # Cloudflare Workers config
└── package.json
```

---

## License

MIT License — see [LICENSE](./LICENSE)

---

## Author

🌀 @ILIVIR3 — Built with Next.js 16, Tailwind CSS 4, shadcn/ui, Cloudflare Workers

# Fredy — AI-Powered Telegram Content Engine

[![Version](https://img.shields.io/badge/version-7.1.0-blue)](https://github.com/ILIV007/Fredy-admin)
[![Runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Fredy is a serverless, AI-driven content publishing system for Telegram channels. Built on Cloudflare Workers, it automatically fetches, curates, rewrites, and publishes developer-focused content to your Telegram channel.

## ✨ Features

### Content Sources (12 Plugins)
- **GitHub** — Trending repositories by topic
- **GitHub Releases** — Latest releases from 15 popular repos (VS Code, React, Rust, Deno, etc.)
- **GitHub Trending** — Most-starred repos from the past week
- **Dev.to** — Top developer articles
- **Stack Exchange** — High-voted Stack Overflow questions
- **Hacker News** — Top stories (score > 50)
- **Tech News** — Technology headlines via NewsAPI
- **NASA APOD** — Astronomy Picture of the Day
- **JokeAPI** — Programming jokes
- **XKCD** — Latest comics
- **Wikimedia** — Today in tech history
- **Reddit** — Programming subreddit posts (disabled — Reddit blocks server-side requests)

### AI Engine
- **Google Gemini** (primary) — 5 models including gemini-3-flash-preview
- **OpenRouter** (fallback) — 6 free models including Llama 3.3, Qwen3, GPT-OSS
- **Format-only fallback** — When all AI providers fail, publishes cleaned raw content
- **Quality scoring** — 6-dimension quality evaluation (0-100)
- **Language support** — English, Persian (فارسی), and auto-detect

### Post Formatting
- **Markdown to HTML** — AI output with `**bold**`, `> quotes`, `>! collapsible` converted to Telegram HTML
- **Blockquotes** — Long paragraphs, step-by-step instructions, and code examples wrapped in `<blockquote>`
- **Collapsible quotes** — Very long paragraphs use `<blockquote expandable="true">`
- **Source links** — Clickable source URL in blockquote with random emoji
- **Channel footer** — `🌀 @ILIVIR3` in blockquote (HTML entity encoded to prevent Telegram mention parsing)
- **No truncation** — Full post content, no "..." cuts

### Admin Panel (Telegram Bot)
- **Dashboard** — Bot status, version, scheduler, stats at a glance
- **Quick controls** — Toggle bot on/off, toggle approve mode, refresh
- **Manual post** — Publish from any of 11 APIs or by category (A/B/C)
- **Settings** — Language, posts/day, quality threshold, burst mode, dedup
- **Editor** — AI temperature, max tokens, quality threshold, prompt profile
- **Providers** — Toggle AI providers and plugins, test individually
- **Scheduler** — Enable/disable, view slots, force tick
- **Categories** — Per-category limits, weights, rotation order
- **Debug** — Test KV, Telegram, view logs and errors
- **Stats** — Publishing history, per-category breakdown

### Manager Dashboard (Web)
- **Dashboard** — System overview with toggle buttons
- **Post to Channel** — Select any API, fetch, process, and publish with full JSON report
- **Back-Test** — 9-point system test + Full Checkup (complete JSON diagnostic)
- **AI** — Provider status, model list with priority, per-model testing
- **Queue** — Per-category queue depth with min/target indicators
- **Scheduler** — Slot schedule, next fire time, posts today
- **Statistics** — 7-day publishing history
- **Logs** — Recent updates and errors with copy buttons
- **Configuration** — Full settings JSON viewer
- **System** — Clear dedup, queue, logs, source caches, reset settings

### Scheduling
- **External cron** — cron-job.org calls `/internal/tick` every 2 hours
- **Internal backup cron** — Cloudflare cron trigger every 24 hours as safety net
- **Non-blocking** — Tick endpoint returns 200 immediately, work runs in `ctx.waitUntil()`
- **Slot-based** — 4 daily slots (09:00, 13:00, 18:00, 22:00) with ±30min jitter
- **Approve mode** — When ON, scheduler pauses; manual publishing still works

### Storage
- **Cloudflare KV** — Single namespace (`Fredy_SETTINGS`) with key prefixes
- **Config cache** — 30-second in-memory cache to reduce KV reads
- **Batched stats** — In-memory stat counters, flushed periodically
- **Source cache** — Per-plugin KV cache (30min–24hr TTL) to reduce API calls

## 🚀 Quick Start

### Prerequisites
- Cloudflare account (free tier works)
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Google Gemini API key from [AI Studio](https://aistudio.google.com/apikey)
- OpenRouter API key from [openrouter.ai](https://openrouter.ai/keys)
- Optional: NewsAPI, NASA API, GitHub tokens

### Installation

```bash
# Clone the repo
git clone https://github.com/ILIV007/Fredy-admin.git
cd Fredy-admin

# Install dependencies
bun install

# Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put CRON_KEY
npx wrangler secret put ADMIN_ID

# Deploy
npx wrangler deploy
```

### External Cron Setup

1. Go to [cron-job.org](https://cron-job.org)
2. Create a job with URL: `https://<your-worker>.workers.dev/internal/tick?key=<CRON_KEY>`
3. Schedule: every 2 hours
4. Timeout: 60 seconds

## ⚙️ Configuration

All configuration is stored in KV and managed via the Telegram admin panel or Manager web dashboard. No code changes needed for runtime config.

### Key Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `postsPerDay` | 4 | Posts per day (1-20) |
| `qualityThreshold` | 60 | Minimum quality score (0-100) |
| `language.default` | auto | en, fa, or auto |
| `scheduler.enabled` | true | Enable/disable auto-publishing |
| `scheduler.slots` | 09:00,13:00,18:00,22:00 | Daily posting times |
| `scheduler.refreshIntervalMinutes` | 120 | Source cache refresh interval |
| `ai.primaryProvider` | gemini | Primary AI provider |
| `ai.retryCount` | 0 | AI retry attempts (0 = no retry) |
| `approveMode` | false | Require manual approval before publishing |

## 📊 API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | Public | Health check |
| `/version` | GET | Public | Version info |
| `/health` | GET | Public | Detailed system status |
| `/Manager` | GET | DEBUG_TOKEN | Web dashboard |
| `/Manager/api/*` | GET/POST | DEBUG_TOKEN | Dashboard API |
| `/internal/tick` | GET/POST | CRON_KEY | Cron trigger |
| `/webhook` | POST | WEBHOOK_SECRET | Telegram updates |
| `/webhook/info` | GET | Public | Bot info |

## 🏗️ Architecture

```
Entry Layer → Orchestrators → Services → Primitives
     ↓              ↓            ↓
  webhook.ts   admin.ts    ai-service.ts
  tick.ts      scheduler   content-manager.ts
  manager.ts               final-publisher.ts
  cron.ts                  ux-layer.ts
```

- **Entry** — HTTP/cron handlers, return 200 immediately
- **Orchestrators** — Route updates, manage scheduling
- **Services** — AI, content pipeline, publishing, config
- **Primitives** — Pure functions (hash, time, strings)
- **Plugins** — Content sources and AI providers (pluggable)

## 🔒 Security

- `ADMIN_ID` — Only the configured admin can use the bot
- `CRON_KEY` — Required for `/internal/tick` endpoint
- `WEBHOOK_SECRET` — Optional Telegram webhook verification
- `DEBUG_TOKEN` — Optional Manager dashboard protection

## 📝 License

MIT — See [LICENSE](LICENSE)

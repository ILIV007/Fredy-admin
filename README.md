# Fredy v13.4.13

> **Autonomous AI-powered Technology News Hub for Telegram channels.**
> Built on Cloudflare Workers Free Tier. NASA batch-fetch with dedup-aware image guarantee, duplicate forwarding to admin PM, Tier V scheduled content, Jamendo Night Music, 10-stage quality pipeline, weighted provider selection, and 492 passing tests.

[![Version](https://img.shields.io/badge/version-13.4.13-blue)](./VERSION)
[![Runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-492%20passing-brightgreen)](./scripts)
[![Channel](https://img.shields.io/badge/Telegram-@ILIVIR3-2AABEE)](https://t.me/ILIVIR3)

---

## Overview

Fredy is a production-grade, serverless content publishing platform that automatically fetches, processes, and publishes high-quality technology news to Telegram channels. It evolved from a Developer Content Bot into a complete **Technology News Hub** with Tier H (Hardware & Technology Headlines) and Tier V (Scheduled Content — NASA APOD + Night Music).

### What Makes Fredy Different

- **25 Content Source Providers** across 6 tiers (S/A/B/H/V/Legacy) — RSS, REST API, GraphQL, JSON
- **NASA Batch Fetch (v13.4.12)** — fetches 14 days of APODs in 1 API call, dedup-aware image selection guarantees a NASA image every day (even on video days, uses throwback from recent unpublished images)
- **Duplicate Forwarding (v13.4.9)** — pipeline-rejected duplicates are forwarded to admin PM as formatted posts + duplicate notices (admin can manually forward to channel)
- **NASA Image Guarantee (v13.4.10)** — 4-layer image resolution: plugin media → MediaResolver → ImageResolver og:image → NASA page og:image fetch
- **Tier H Hardware News** — Ars Technica, Tom's Hardware, TechPowerUp with Quality Filter (0-100 scoring, deal/promo rejection, clickbait hard-reject)
- **Tier V Scheduled Content** — NASA APOD at 23:20 + Night Music (Jamendo CC audio) at 23:23
- **Night Music** — Creative Commons audio from Jamendo API, sent via `sendAudio()` with native Telegram playback, 10-stage quality pipeline, 180-day song dedup + 30-day artist cooldown
- **Novelty Score** — prevents same news from different providers being published within 48h
- **Weighted Provider Selection** — `selectProviderWeighted()` uses config weights (e.g., GitHub Releases weight=100 > StackExchange weight=80)
- **Equal-Segment Schedule** — day divided into N equal segments, each post gets its own segment with center-bias sampling (v13.1.2)
- **Truly Random Wildcard** — daily wildcard post picks from ALL active APIs (never picks H slots)
- **6 AI Models** — Gemini (primary) + OpenRouter (fallback, 6 free models)
- **Zero-KV Quiet Hours** — 0 KV reads + 0 KV writes during quiet hours (except Tier V)
- **492 Passing Tests** across 7 test suites

---

## Telegram Channel

**[@ILIVIR3](https://t.me/ILIVIR3)** — Live channel powered by Fredy.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker (Free Tier)                  │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Layer 1     │  │  Layer 2      │  │  Layer 3                │ │
│  │  Scheduler   │  │  Provider     │  │  Maintenance            │ │
│  │  (20-min     │  │  Refresh      │  │  (daily at midnight)    │ │
│  │   cron)      │  │  (2h cron)    │  │                         │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────────────────────┘ │
│         │                  │                                      │
│  ┌──────▼──────────────────▼──────────────────────────────────┐  │
│  │                    Content Pipeline                         │  │
│  │  Fetch → Normalize → Freshness → Dedup → Popularity →      │  │
│  │  Rank → AI (Gemini/OpenRouter) → Quality → Format →        │  │
│  │  Media → Telegram → History → Dedup Record                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Tier V (Fixed Schedule)                                     │ │
│  │  00:00 NASA APOD (image + explanation)                      │ │
│  │  00:03 Night Music (Jamendo CC audio via sendAudio)         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Cloudflare KV  │  │  Telegram    │  │  Admin Manager     │  │
│  │  (storage)      │  │  Bot API     │  │  Dashboard (/Manager)│ │
│  └─────────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Content Providers

### Tier S — Core (refresh every 2h)
| Provider | Category | Source | Images |
|----------|----------|--------|--------|
| GitHub Releases | A | REST API | ✅ |
| GitHub Events | A | REST API | ❌ |
| GitHub Trending | A | REST API | ✅ |
| GitHub Topic Search | A | REST API | ✅ |
| Dev.to | A | REST API | ✅ |
| Hacker News (Algolia) | B | REST API | ❌ |
| NASA APOD | V (Tier V) | REST API | ✅ |

### Tier A — Important (refresh every 6h)
| Provider | Category | Source | Images |
|----------|----------|--------|--------|
| Cloudflare Blog | B | RSS | ❌ |
| Hugging Face Blog | A | RSS | ❌ |
| Stack Overflow | A | REST API | ✅ |
| Product Hunt | B | RSS | ✅ |

### Tier B — Supporting (refresh every 12h)
| Provider | Category | Source | Images |
|----------|----------|--------|--------|
| GitHub Security | A | REST API | ❌ |
| OpenAI News | B | RSS | ❌ |
| Reddit Programming | A | Reddit JSON | ❌ |
| XKCD | C | JSON | ✅ |

### Tier H — Hardware Headlines (refresh every 4h)
| Provider | Category | Source | Images |
|----------|----------|--------|--------|
| Ars Technica | H | RSS | ✅ |
| Tom's Hardware | H | RSS | ✅ |
| TechPowerUp | H | RSS | ✅ |

### Tier V — Scheduled Content (fixed schedule)
| Provider | Time | Description |
|----------|------|-------------|
| NASA APOD | 23:20 | Astronomy Picture of the Day — batch fetch 14 days, dedup-aware image selection |
| Night Music | 23:23 | CC audio from Jamendo API via `sendAudio()` |

---

## Night Music (Tier V)

Every night at 23:23, Fredy publishes one Creative Commons audio track from the Jamendo API.

### How it works

1. Fetch 100 tracks from Jamendo API (`order=popularity_week`)
2. Run a 10-stage quality pipeline:
   - Stage 1: Required fields (title, artist, audio URL)
   - Stage 2: Must be downloadable
   - Stage 3: Duration 2-10 minutes
   - Stage 4: Reject low-quality titles (demo, karaoke, live, remix, ASMR, etc.)
   - Stage 5: Artist cooldown (30-day KV dedup)
   - Stage 6: Song cooldown (180-day KV dedup, normalized artist+title)
   - Stage 7: Prefer tracks with album artwork
   - Stage 8: Weighted quality score (0-100, reject < 40)
   - Stage 9: Weighted random selection
   - Stage 10: Record publication in KV (only after successful upload)
3. Worker downloads the MP3 (with Content-Type + 20MB size check)
4. Uploads binary to Telegram via `sendAudio()` multipart/form-data
5. Admin PM receives a copy of the audio post

### Post format
```
Song Name              (monospace)
Artist Name            (monospace)

🌀 @ILIVIR3
```

### KV usage
- `fredy:music:artist:<normalized>` — 30-day TTL
- `fredy:music:song:<hash>` — 180-day TTL
- Only 2 KV writes per night (recorded AFTER successful upload)

---

## NASA APOD (Tier V) — v13.4.12 Batch Fetch

Every night at 23:20, Fredy publishes a NASA Astronomy Picture of the Day. The plugin guarantees **a NASA image is published every single day** — even when today's APOD is a video.

### How it works (v13.4.12)

1. **Batch fetch** — fetches the last **14 days** of APODs in ONE API call (`start_date` + `end_date`)
2. **Filter** — removes video APODs (user request: only images, no videos)
3. **Sort** — by date descending (most recent first)
4. **Dedup-aware selection** — for each image APOD candidate, checks the dedup KV:
   - If NOT published → return it (most recent unpublished image)
   - If ALL published → return the most recent anyway (throwback)
5. **4-layer image guarantee** (v13.4.10):
   - Layer 1: Plugin sets `media` + `imageUrl` (direct image URL)
   - Layer 2: MediaResolver validates and returns the media
   - Layer 3: ImageResolver fetches og:image from the APOD page URL
   - Layer 4: NASA Image Guarantee fetches og:image directly (last resort)

### Daily scenarios

| Day type | Behavior |
|----------|----------|
| **Image day** | Today's APOD published (normal) |
| **Video day** | Most recent unpublished image from last 14 days (throwback) |
| **Consecutive video days** | Walks further back until unpublished image found |
| **All 14 days published** | Re-publishes most recent image (rare edge case) |

### API efficiency
- Only **1 API call per day** (batch fetch returns 14 days at once)
- Raw batch cached for 6 hours (retries within same night don't hit API)
- DEMO_KEY: 50 requests/day (we use 1) | Real key: 1,000/hour

### KV usage (v13.4.13 optimized)
- `fredy:source:nasa:apod:raw` — 6h TTL (raw APODResponse[] batch cache)
- `fredy:source:nasa:migrated-v13.4.13` — 7-day TTL (one-time migration flag)
- `fredy:dedup:canonical:nasa:YYMMDD` — 30-day TTL (checked during selection)
- **Reads per fetch**: 1-14 (best case 1, average 2-3, worst case 14)
- **Writes per fetch**: 0 (writes happen in FinalPublisher after publish)
- **Migration**: one-time `delete(old_key)` + `set(flag)` on first run only

---

## Schedule System

### Normal Posts (A/B/C/H)
- Day divided into N equal segments (N = total post count)
- Each post gets a random time in the middle 60% of its segment
- Daily offset (0-30 min) shifts segment boundaries
- Quiet hours (00:00-07:30) = zero KV operations
- 10 posting windows (08:00-22:00, overlapping)

### Tier V (Fixed Schedule)
- No jitter — fires at exact configured time
- Checked BEFORE quiet hours guard (so 00:00/00:03 posts fire during quiet hours)
- Independent from strategy engine

### Strategy Modes
| Mode | A | B | C | H | Total |
|------|---|---|---|---|-------|
| Minimal | 2 | 1 | 0 | 0 | 3 |
| Conservative | 2 | 1 | 1 | 1 | 5 |
| Balanced | 3 | 1 | 1 | 1 | 6 |
| Active | 4 | 2 | 1 | 2 | 9 |
| Aggressive | 5 | 3 | 1 | 3 | 12 |
| Turbo | 6 | 4 | 1 | 4 | 15 |

---

## Quality Pipeline

### Content Pipeline (15 stages)
1. Source Fetch → 2. Normalize → 3. Freshness Filter → 4. Dedup (3-layer: canonical + URL + hash) → 5. Popularity Filter → 6. Candidate Ranking → 7. Top-N Selection → 8. Language Detection → 9. AI Rewrite (Gemini/OpenRouter) → 10. Response Parse → 11. Quality Engine → 12. Content Validator → 13. Media Handler → 14. Telegram Publish → 15. Dedup Record

### Tier H Quality Filter
- **Positive signals**: GPU/CPU launches, AI hardware, cybersecurity, self-driving, quantum, cloud, etc.
- **Negative signals**: buying guides, deals, discounts, "save $", black friday, opinion articles, minor driver updates, etc.
- **Clickbait hard-reject** (penalty = -100): "Everything you need to know", "Best...", "Deal:", "Save $..."
- **Threshold**: 50 (lowered from 70 to accept broader tech news)

---

## Security

### Manager Dashboard
- Protected by `MANAGER_TOKEN` (dedicated secret, separate from `DEBUG_TOKEN`)
- Fallback to `DEBUG_TOKEN` for backward compatibility
- Supports: Authorization header, query parameter, cookie

### Telegram Bot Admin Panel
- Admin-only access (verified by `ADMIN_ID`)
- Manager Dashboard button includes token in URL for direct access

---

## Configuration

### Required Secrets
```bash
npx wrangler secret put ADMIN_ID        # Your Telegram numeric user ID
npx wrangler secret put BOT_TOKEN        # From @BotFather
npx wrangler secret put GEMINI_API_KEY   # From https://aistudio.google.com/apikey
npx wrangler secret put OPENROUTER_API_KEY # From https://openrouter.ai/keys
npx wrangler secret put CRON_KEY         # Random string for cron auth
```

### Recommended Secrets
```bash
npx wrangler secret put MANAGER_TOKEN    # Manager dashboard security
npx wrangler secret put WEBHOOK_SECRET   # Webhook verification
npx wrangler secret put MANAGER_URL      # Manager URL (e.g., https://your-worker.workers.dev/Manager)
```

### Optional Secrets
```bash
npx wrangler secret put NASA_API_KEY       # NASA APOD
npx wrangler secret put GITHUB_TOKEN       # Higher GitHub API rate limit
npx wrangler secret put JAMENDO_CLIENT_ID  # Night Music (Jamendo API)
```

---

## Deployment

### Quick Start
```bash
# 1. Install dependencies
bun install

# 2. Set secrets (see Configuration above)
npx wrangler secret put BOT_TOKEN
# ... repeat for each secret

# 3. Deploy
npx wrangler deploy

# 4. Set webhook (optional, for bot commands)
bash scripts/set-webhook.sh

# 5. Run tests
bun run test
```

### Environment Variables (wrangler.toml)
```toml
[vars]
DEFAULT_AI_PROVIDER = "gemini"
DEFAULT_LANGUAGE = "fa"
SCHEDULER_TIMEZONE = "Asia/Tehran"
SCHEDULE_SLOTS = "09:00,13:00,18:00,22:00"
SCHEDULE_JITTER_MINUTES = "30"
MANAGER_URL = "https://your-worker.workers.dev/Manager"
```

---

## Testing

```bash
# Run all tests
bun run test

# Individual suites
bun run test:scheduler    # 87 tests — time generation, slot firing, quiet hours
bun run test:strategy     # 191+ tests — plan gen, weekly themes, wildcard
bun run test:pipeline     # 41 tests — content pipeline 15-stage flow
bun run test:dedup        # 28 tests — 3-layer dedup (canonical + URL + hash)
bun run test:registry     # 80 tests — 25 providers config consistency
bun run test:tier-h       # 35 tests — quality scoring, deal/promo rejection
bun run test:novelty      # 26 tests — hardware news trend detection
```

**Total: 488 tests passing across 7 suites.**

---

## Project Structure

```
Fredy-admin/
├── src/
│   ├── core/              # Constants, config sections, provider config
│   ├── services/          # 40+ service modules
│   │   ├── scheduler-service.ts      # Main scheduler (fireSlot, acquireContent)
│   │   ├── strategy-engine.ts        # Plan generation, provider selection
│   │   ├── time-generator.ts         # Equal-segment schedule algorithm
│   │   ├── final-publisher.ts        # Telegram publish (sendPhoto/sendAudio/sendMessage)
│   │   ├── duplicate-detector.ts     # 3-layer dedup (canonical + URL + hash)
│   │   ├── tier-h-filter.ts          # Quality scoring for hardware news
│   │   ├── tier-v-scheduler.ts       # Fixed-schedule content (NASA, Night Music)
│   │   └── ...
│   ├── plugins/
│   │   ├── sources/       # 25 content source plugins
│   │   │   ├── nasa/                 # NASA APOD (Tier V)
│   │   │   ├── night-music/          # Jamendo CC audio (Tier V)
│   │   │   ├── ars-technica/         # RSS (Tier H)
│   │   │   ├── toms-hardware/        # RSS (Tier H)
│   │   │   ├── techpowerup/          # RSS (Tier H)
│   │   │   ├── github/               # REST API (Tier S)
│   │   │   └── ...
│   │   └── ai/            # AI providers (Gemini, OpenRouter)
│   ├── admin/             # Telegram bot admin panel
│   ├── entry/             # Cloudflare Workers entry points
│   └── types/             # TypeScript type definitions
├── scripts/               # Test suites + deployment scripts
├── docs/                  # Architecture docs, soul.md, guidelines
├── wrangler.toml          # Cloudflare Workers config
└── package.json
```

---

## License

MIT License — Built for the developer community by **@ILIVIR3**.

---

## Links

- **Telegram Channel**: [@ILIVIR3](https://t.me/ILIVIR3)
- **Cloudflare Workers**: [workers.cloudflare.com](https://workers.cloudflare.com)
- **Jamendo API**: [developer.jamendo.com](https://developer.jamendo.com/v3.0)
- **Gemini AI**: [aistudio.google.com](https://aistudio.google.com/apikey)
- **OpenRouter**: [openrouter.ai](https://openrouter.ai)

---

> 🌀 **@ILIVIR3** · MIT License · Built with Next.js 16 · Tailwind CSS 4 · shadcn/ui · Cloudflare Workers

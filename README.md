# Fredy

> **AI-powered Telegram Content Engine for Developer Channels**

[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Fredy is a production-ready, serverless Content Operating System that automatically collects, processes, and publishes high-quality developer content to Telegram channels. Built entirely on Cloudflare's free tier — no paid infrastructure required.

---

## ✨ Features 

- **Plugin-based architecture** — 12 content source providers (GitHub, NewsAPI, NASA, JokeAPI, Hacker News, Dev.to, StackExchange, Reddit, XKCD, GitHub Releases, GitHub Trending, Wikimedia)
- **AI-powered content generation** — Google Gemini (primary) + OpenRouter (fallback) with multi-model race and automatic provider switching
- **Multi-source content ingestion** — all providers follow a shared `Plugin` interface; add new sources without touching core code
- **Media resolver system** — 5-priority image selection (Provider → OpenGraph → GitHub Social → Logo → None); never generates AI images, never stores images in KV
- **Content quality scoring** — 6-dimension scoring engine (technical value, readability, novelty, channel fit, spam detection, AI confidence); 60+ threshold to publish
- **Smart scheduler with random posting** — slot-based scheduling with configurable time windows, jitter, and minimum gap between posts
- **Humanized post formatting** — strips metadata, AI clichés, and system traces; produces clean, human-like posts
- **Hook-based engagement system** — dynamic, content-aware hooks generated per post (4 strategies: category-specific, insight, action, question)
- **Admin-only Telegram control panel** — 10 inline-keyboard screens (Dashboard, Settings, Categories, Providers, AI, Manual, Schedule, Soul.md, Debug, Stats) + 6 commands
- **Real-time debug dashboard** — web UI at `/debug` with 11 API endpoints, log viewer, KV tester, AI tester, simulation mode
- **Fully configurable runtime system** — 14 pluggable config sections with Zod schema validation, migration support, and KV-backed storage
- **KV-based caching and queue system** — batched stats (reduces KV writes), per-category FIFO queues with dead-letter queue, 7-day dedup store

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (serverless, V8 isolates) |
| Language | TypeScript (strict mode, zero `any`) |
| Storage | Cloudflare KV (settings, state, queue, dedup, history) |
| AI | Google Gemini (free tier) + OpenRouter (free models) |
| Messaging | Telegram Bot API (HTML parse mode) |
| Validation | Zod schemas on every config write |
| Architecture | 4-layer (Entry → Orchestrators → Services → Primitives), plugin-first, DI container |

---

## 🏗 Architecture

```
Plugins → Enrichment → AI → Quality Score → UX Layer → Scheduler → Telegram
```

### System Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                             │
│                                                                     │
│  Webhook (POST /webhook)          Cron (every minute)               │
│         │                              │                            │
│         ▼                              ▼                            │
│  ┌──────────────┐              ┌──────────────┐                    │
│  │  Admin Panel │              │  Scheduler   │                    │
│  │  (10 screens)│              │  tick()      │                    │
│  └──────┬───────┘              └──────┬───────┘                    │
│         │                             │                             │
│         │    ┌────────────────────────┼──────────────────┐         │
│         │    │                        │                  │         │
│         ▼    ▼                        ▼                  ▼         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Content Pipeline                          │  │
│  │                                                              │  │
│  │  1. ContentNormalizer     → StandardPost                     │  │
│  │  2. EnrichmentEngine      → enriched StandardPost            │  │
│  │  3. TaggingSystem         → tagged StandardPost              │  │
│  │  4. ContentValidator      → validate required fields         │  │
│  │  5. DuplicateDetector     → URL + hash + title check         │  │
│  │  6. CategoryResolver      → confirm category                 │  │
│  │  7. AIService.generate()  → AI text + quality score          │  │
│  │  8. QualityEngine         → 6-dimension score (≥60 to pass)  │  │
│  │  9. ContentFormatter      → ReadyContent                     │  │
│  │ 10. ContentQueue.enqueue  → ready queue                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Final Publisher                            │  │
│  │                                                              │  │
│  │  ReadyContent → UXLayer → FinalPost → Telegram              │  │
│  │                                                              │  │
│  │  • HookEngine: dynamic content-aware hooks                   │  │
│  │  • UXLayer: humanize, strip metadata, extract takeaway       │  │
│  │  • Quality Gate: score < 60 → reject                         │  │
│  │  • Retry: max 2 retries on Telegram failure                  │  │
│  │  • HistoryService: 90-day publish history                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│                    📤 Published to @ILIVIR3                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 4-Layer Architecture

| Layer | Folder | Responsibility |
|---|---|---|
| **4. Entry** | `src/entry/` | Request routers (webhook, cron, debug, health) |
| **3. Orchestrators** | `src/orchestrators/` | Workflows that compose services (admin, scheduler) |
| **2. Services** | `src/services/` | Single-domain business logic (35+ services) |
| **1. Primitives** | `src/primitives/` | Pure functions, no I/O (strings, time, html, hash, random) |

**Rule:** dependencies flow down only. Layer N may import Layer N-1, never the reverse.

### Plugin Architecture

```
src/core/         ← defines interfaces (Plugin, AIProvider, Formatter)
src/plugins/      ← implements interfaces
src/container.ts  ← wires plugins to managers
```

Core **never** depends on a concrete plugin. Adding a new content source = 4 steps, no core code changes.

---

## 📦 Installation

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Telegram Bot Token](https://t.me/BotFather) — create a bot via @BotFather
- [Google AI Studio API key](https://aistudio.google.com/apikey) — for Gemini (free tier)
- [OpenRouter API key](https://openrouter.ai/keys) — for fallback AI (free models)
- [Node.js](https://nodejs.org/) 18+ and npm

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/fredy.git
   cd fredy
   npm install
   ```

2. **Login to Cloudflare:**
   ```bash
   npx wrangler login
   ```

3. **Create a KV namespace:**
   ```bash
   npx wrangler kv namespace create SETTINGS
   ```
   Copy the `id` from the output and paste it into `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "SETTINGS"
   id = "YOUR_KV_NAMESPACE_ID"
   ```

4. **Set secrets** (via Cloudflare dashboard or CLI):
   ```bash
   npx wrangler secret put BOT_TOKEN          # from @BotFather
   npx wrangler secret put GEMINI_API_KEY     # from aistudio.google.com
   npx wrangler secret put OPENROUTER_API_KEY # from openrouter.ai/keys
   npx wrangler secret put WEBHOOK_SECRET     # random string for webhook verification
   npx wrangler secret put DEBUG_TOKEN        # random string for /debug protection
   ```

5. **Configure `wrangler.toml`:**
   ```toml
   [vars]
   ADMIN_ID = "YOUR_TELEGRAM_USER_ID"   # from @userinfobot
   TARGET_CHANNEL = "@YOUR_CHANNEL"
   FOOTER_TEXT = "🌀 @YOUR_CHANNEL"
   DEBUG_MODE = "false"
   DEFAULT_AI_PROVIDER = "openrouter"
   DEFAULT_LANGUAGE = "auto"
   SCHEDULER_TIMEZONE = "Asia/Tehran"
   SCHEDULE_SLOTS = "09:00,13:00,18:00,22:00"
   SCHEDULE_JITTER_MINUTES = "30"
   ```

6. **Deploy:**
   ```bash
   npx wrangler deploy
   ```

7. **Set the webhook:**
   ```bash
   curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -d "url=https://<YOUR_WORKER>.workers.dev/webhook" \
     -d "secret_token=<YOUR_WEBHOOK_SECRET>"
   ```

8. **Verify:**
   - Send `/start` to your bot in Telegram → admin panel should appear
   - Visit `https://<YOUR_WORKER>.workers.dev/` → health check JSON
   - Visit `https://<YOUR_WORKER>.workers.dev/debug` → debug dashboard

---

## ⚙️ Configuration

Fredy uses a **pluggable section-based configuration system**. All runtime config is stored in KV at `fredy:settings:<adminId>` and validated with Zod schemas on every write.

### Config Sections (14)

| Section | Key Fields | Description |
|---|---|---|
| `general` | botEnabled, maintenanceMode, timezone | Bot-wide toggles |
| `telegram` | targetChannel, adminId, footer, parseMode | Telegram channel config |
| `language` | default, supported, autoDetect | Language settings |
| `scheduler` | enabled, slots, jitterMinutes, postingWindows | Posting schedule |
| `categories` | A/B/C (enabled, dailyLimit, priority, weight, fallback) | Category quotas |
| `ai` | primaryProvider, fallbackProvider, temperature, maxTokens, qualityThreshold | AI generation |
| `providers` | gemini/openrouter (enabled, models, timeout, retry, dailyLimit) | AI provider config |
| `content` | postsPerDay, categoryDistribution, duplicatePrevention, emojiPool | Content rules |
| `quality` | minScore, duplicateDetection, spamPatterns, minLength, maxLength | Quality filter |
| `debug` | enabled, logLevel, simulationMode, verboseOutput | Debug system |
| `logging` | kvWrites, consoleLevel, kvLevel, includeStackTrace | Logging config |
| `nasa` | dailyPost, captionLength, imagePreference | NASA-specific |
| `plugins` | defaultTimeout, defaultRetry, perPlugin overrides | Plugin manager |
| `future` | extensions | Free-form experimental config |

### Config API

```typescript
// Read
const settings = await container.config.getSettings(adminId);

// Write (deep-merge patch, validated before saving)
await container.config.updateSettings(adminId, { ai: { temperature: 0.5 } });

// Reset
await container.config.resetSettings(adminId);

// Export / Import (backup)
const { json } = await container.config.exportSettings(adminId);
await container.config.importSettings(adminId, jsonString);
```

See `docs/CONFIG_GUIDE.md` for the complete reference.

---

## 🔒 Security

- **Admin-only system** — all Telegram commands and callbacks require `ADMIN_ID` match
- **No public write access** — webhook verifies `WEBHOOK_SECRET` header; debug dashboard requires `DEBUG_TOKEN`
- **Secrets stored in Cloudflare** — all API keys are set via `wrangler secret put`, never in code or `wrangler.toml`
- **Secret masking** — debug dashboard shows `has_bot_token: true` instead of the actual token
- **Rate-limited API calls** — per-provider rate limits configured in plugin manifests
- **No image storage** — MediaResolver stores only URLs, never image binaries in KV

---

## 📁 Project Structure

```
fredy/
├── src/
│   ├── entry/              # Layer 4: request routers
│   ├── orchestrators/      # Layer 3: workflows (admin, scheduler)
│   ├── services/           # Layer 2: 35+ single-domain services
│   ├── primitives/         # Layer 1: pure functions
│   ├── core/               # Cross-cutting (errors, constants, schemas, config)
│   ├── plugins/            # Plugin implementations
│   │   ├── sources/        # 12 content source plugins
│   │   ├── ai/             # AI provider plugins (Gemini, OpenRouter)
│   │   └── formatters/     # Formatter plugins (HTML)
│   ├── admin/              # Admin panel (screens, commands, keyboards)
│   ├── types/              # Global type definitions
│   ├── container.ts        # DI container wiring
│   └── index.ts            # Worker entry point
├── docs/                   # Documentation
├── migrations/             # D1 SQL migrations (optional analytics)
├── scripts/                # Test scripts
├── wrangler.toml           # Cloudflare Worker config
├── tsconfig.json           # TypeScript strict config
└── package.json
```

---

## 🧩 Adding a New Content Source

1. Create `src/plugins/sources/my-source/manifest.ts`:
   ```typescript
   export const mySourceManifest: PluginManifest = {
     id: "my-source",
     name: "My Source",
     version: "1.0.0",
     enabled: true,
     category: "A",
     priority: 6,
     rateLimit: 60,
     supportsImages: false,
     homepage: "https://example.com",
     supportsMarkdown: true,
     supportsLanguage: ["en"],
   };
   ```

2. Create `src/plugins/sources/my-source/index.ts` — implement the `Plugin` interface (`fetch`, `normalize`, `validate`, `supportsMedia`, `getSource`, `getCategory`, `health`)

3. Add to `src/plugins/sources/index.ts`:
   ```typescript
   export { MySourcePlugin, createMySourcePlugin, mySourceManifest } from "./my-source";
   ```

4. Add to `src/services/plugin-loader.ts`:
   ```typescript
   { id: "my-source", factory: createMySourcePlugin },
   ```

**That's it.** No orchestrator, service, or screen edits needed.

---

## 🧪 Debug Dashboard

Visit `https://<YOUR_WORKER>.workers.dev/debug` (requires `DEBUG_TOKEN`):

- **Status cards** — env introspection with masked secrets
- **Quick tests** — KV round-trip, Telegram message, cron queue trigger
- **Log viewer** — recent updates, errors, raw webhook requests (30 each)
- **API endpoints** — 11 endpoints for programmatic access

---

## 📊 Posting Rules (Default — All Configurable)

| Category | Posts/Day | Content | Examples |
|---|---|---|---|
| A | 2 | Programming, AI, GitHub, Dev Tools | Repos, tutorials, frameworks |
| B | 1 | Technology News | Industry news, announcements |
| C | 1 | NASA, Jokes, Quotes, Facts | APOD, XKCD, dev humor |
| **Total** | **4** | Random times, min 30-min gap, ±30-min jitter | |

---

## 📝 License

MIT — see [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

- Built on [Cloudflare Workers](https://workers.cloudflare.com/) — serverless, free tier
- AI by [Google Gemini](https://ai.google.dev/) and [OpenRouter](https://openrouter.ai/)
- Inspired by the developer community at [ILIVIR3](https://t.me/ILIVIR3)

---

**Fredy** — *Curated developer content, automatically.*

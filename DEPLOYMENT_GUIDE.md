# Fredy — Deployment & Setup Guide

> **Complete step-by-step guide** for deploying Fredy on Cloudflare Workers.
> **Version:** 1.4.0 | **Date:** 2026-07-05

---

## Quick Start (Automated)

```bash
# 1. Clone and install
git clone https://github.com/yourusername/fredy.git
cd fredy
npm install

# 2. Run the automated setup script
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Set the Telegram webhook
./scripts/set-webhook.sh <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>

# 4. Verify deployment
npx tsx scripts/verify-setup.ts <WORKER_URL> <DEBUG_TOKEN>
```

---

## Manual Setup (Step-by-Step)

### 1. Required External APIs

Register and obtain API keys for each service:

#### A) Telegram Bot API (MANDATORY)

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot`
3. Choose a name and username
4. Copy the **BOT_TOKEN**
5. Add the bot as **administrator** to your channel
6. Enable **Post Messages** and **Schedule Messages** permissions

**Secret:** `BOT_TOKEN`

#### B) Google AI Studio — Gemini (PRIMARY AI, MANDATORY)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with Google
3. Click "Create API Key"
4. Copy the key

**Secret:** `GEMINI_API_KEY`
**Free tier:** 15 RPM, 1,500 requests/day

#### C) OpenRouter (FALLBACK AI, MANDATORY)

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Sign up
3. Click "Create Key"
4. Copy the key

**Secret:** `OPENROUTER_API_KEY`
**Free tier:** 20 RPM, free models available

#### D) NewsAPI (CATEGORY B, RECOMMENDED)

1. Go to [newsapi.org](https://newsapi.org)
2. Sign up for free tier
3. Copy the API key from your dashboard

**Secret:** `NEWSAPI_KEY`
**Free tier:** 100 requests/day, 1 req/sec

#### E) NASA API (CATEGORY C, RECOMMENDED)

1. Go to [api.nasa.gov](https://api.nasa.gov)
2. Sign up
3. Copy the API key

**Secret:** `NASA_API_KEY`
**Free tier:** 1,000 requests/hour
**Note:** `DEMO_KEY` works but is heavily rate-limited.

#### F) GitHub API (OPTIONAL)

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Generate a personal access token (no scopes needed)
3. Copy the token

**Secret:** `GITHUB_TOKEN`
**Benefit:** 5,000 req/hr (vs 60/hr unauthenticated)

#### G) Optional APIs (No Key Required)

| API | URL | Used For |
|---|---|---|
| Hacker News | https://github.com/HackerNews/API | Top stories |
| Dev.to | https://developers.forem.com/api | Developer articles |
| StackExchange | https://api.stackexchange.com | Stack Overflow questions |
| XKCD | https://xkcd.com/json.html | Developer comics |
| Wikipedia | https://en.wikipedia.org/api/rest_v1 | Today in history |

---

### 2. Cloudflare Worker Setup

#### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

#### Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

#### Clone and Install

```bash
git clone https://github.com/yourusername/fredy.git
cd fredy
npm install
```

---

### 3. KV Namespace Setup

Fredy uses a single KV namespace with key prefixes (`fredy:*`) for efficient free-tier usage.

```bash
# Create the KV namespace
wrangler kv namespace create SETTINGS
```

Copy the `id` from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SETTINGS"
id = "YOUR_KV_NAMESPACE_ID"
```

**KV Key Map:**

| Prefix | Purpose | TTL |
|---|---|---|
| `fredy:settings:<adminId>` | Runtime config | none |
| `fredy:state:<adminId>` | Runtime state | none |
| `fredy:queue:<category>` | Content queue | 24h |
| `fredy:dlq:<category>` | Dead-letter queue | none |
| `fredy:sched:slots:<date>` | Daily schedule | 48h |
| `fredy:sched:jobs` | Scheduled jobs | 7d |
| `fredy:dedup:*` | Duplicate detection | 7d |
| `fredy:history:<date>` | Publish history | 90d |
| `fredy:source:*` | Source caches | per-source |
| `fredy:plugin:*` | Plugin status | none |
| `fredy:debug:*` | Debug logs | none |

---

### 4. Environment Variables

Set non-secret variables in `wrangler.toml` `[vars]`:

```toml
[vars]
ADMIN_ID = "YOUR_TELEGRAM_USER_ID"
TARGET_CHANNEL = "@ILIVIR3"
FOOTER_TEXT = "🌀 @ILIVIR3"
DEBUG_MODE = "false"
DEFAULT_AI_PROVIDER = "openrouter"
DEFAULT_LANGUAGE = "auto"
SCHEDULER_TIMEZONE = "Asia/Tehran"
SCHEDULE_SLOTS = "09:00,13:00,18:00,22:00"
SCHEDULE_JITTER_MINUTES = "30"
```

**Get your Telegram user ID:** Send `/start` to [@userinfobot](https://t.me/userinfobot).

---

### 5. Secrets Configuration

Set secrets via CLI (recommended) or Cloudflare dashboard:

```bash
# REQUIRED
wrangler secret put BOT_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put OPENROUTER_API_KEY

# RECOMMENDED
wrangler secret put WEBHOOK_SECRET
wrangler secret put DEBUG_TOKEN

# OPTIONAL
wrangler secret put NEWSAPI_KEY
wrangler secret put NASA_API_KEY
wrangler secret put GITHUB_TOKEN
```

**Generate random tokens:**
```bash
openssl rand -hex 32  # for WEBHOOK_SECRET
openssl rand -hex 32  # for DEBUG_TOKEN
```

**Verify secrets are set:**
```bash
wrangler secret list
```

---

### 6. Deploy the Worker

```bash
wrangler deploy
```

Note the Worker URL from the output (e.g., `https://fredy.your-subdomain.workers.dev`).

---

### 7. Webhook Setup

Set the Telegram webhook to point to your Worker:

#### With Webhook Secret (Recommended)

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<WORKER_URL>/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

#### Or use the helper script:

```bash
./scripts/set-webhook.sh <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>
```

#### Verify webhook:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

The response should show `"url": "https://<WORKER_URL>/webhook"` and no `last_error_message`.

---

### 8. Cron Triggers

Fredy uses two cron triggers (configured in `wrangler.toml`):

```toml
[triggers]
crons = ["* * * * *", "*/15 * * * *"]
```

| Cron | Schedule | Purpose |
|---|---|---|
| `* * * * *` | Every minute | Scheduler tick (check for due slots, publish) |
| `*/15 * * * *` | Every 15 min | Source cache refresh (keep content fresh) |

Cron triggers are automatically deployed with `wrangler deploy`. No additional setup needed.

---

### 9. System Initialization Order

When the Worker starts (per isolate), the following happens in order:

1. **Load config from KV** — `ConfigService.getSettings()` reads `fredy:settings:<adminId>`
2. **Validate environment secrets** — `detailedHealthHandler()` checks all required keys
3. **Initialize plugins** — `PluginLoader.loadAll()` registers all 12 content sources
4. **Initialize AI providers** — `ProviderRegistry.register()` for Gemini + OpenRouter
5. **Initialize Media Resolver** — ready to resolve images on demand
6. **Initialize Scheduler** — `DailyPlanner.getOrGenerate()` creates today's schedule
7. **Start webhook listener** — `POST /webhook` is ready to receive Telegram updates

This all happens lazily on the first request (container is built per request).

---

### 10. Admin Access Rule

**ALL system features are restricted to the admin.**

```typescript
// In AdminOrchestrator
private isAdmin(userId: number): boolean {
  const adminId = this.container.env.ADMIN_ID;
  if (!adminId) return false;
  return String(userId) === adminId;
}
```

- **Telegram commands/callbacks:** require `from.id === ADMIN_ID`
- **Debug dashboard (`/debug/*`):** requires `Authorization: Bearer <DEBUG_TOKEN>`
- **Webhook:** requires `X-Telegram-Bot-Api-Secret-Token` header (if `WEBHOOK_SECRET` is set)
- **Health endpoints (`/`, `/version`, `/health`):** public, but expose no sensitive data

**No public admin endpoints.** No write operations are possible without authentication.

---

### 11. Health Check Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/` | GET | None | Basic health (version, liveness, presence flags) |
| `/version` | GET | None | Build info (version, phase, build date, runtime) |
| `/health` | GET | None | Detailed system status (all key checks, missing keys list) |
| `/debug` | GET | DEBUG_TOKEN | HTML debug dashboard |
| `/debug/api/ping` | GET | DEBUG_TOKEN | Liveness check |
| `/debug/api/status` | GET | DEBUG_TOKEN | Full env introspection (masked secrets) |
| `/webhook` | POST | WEBHOOK_SECRET | Telegram update handler |
| `/webhook/info` | GET | None | Bot info (for setup verification) |

#### Example Health Check Response

```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.4.0",
  "phase": "production",
  "checks": {
    "kv": true,
    "botToken": true,
    "adminId": true,
    "geminiKey": true,
    "openRouterKey": true,
    "newsApiKey": true,
    "nasaApiKey": false,
    "githubToken": false,
    "webhookSecret": true,
    "debugToken": true
  },
  "missingRequired": [],
  "missingRecommended": ["NASA_API_KEY", "GITHUB_TOKEN (optional, higher rate limit)"]
}
```

---

### 12. Deploy Checklist

Before going to production, verify each item:

#### Infrastructure
- [ ] Cloudflare account created
- [ ] Wrangler CLI installed and logged in
- [ ] KV namespace created and ID in `wrangler.toml`
- [ ] Worker deployed (`wrangler deploy`)

#### Secrets
- [ ] `BOT_TOKEN` set
- [ ] `GEMINI_API_KEY` set
- [ ] `OPENROUTER_API_KEY` set
- [ ] `WEBHOOK_SECRET` set
- [ ] `DEBUG_TOKEN` set
- [ ] `NEWSAPI_KEY` set
- [ ] `NASA_API_KEY` set
- [ ] `GITHUB_TOKEN` set (optional)

#### Configuration
- [ ] `ADMIN_ID` set in `wrangler.toml`
- [ ] `TARGET_CHANNEL` set in `wrangler.toml`
- [ ] `SCHEDULER_TIMEZONE` set correctly
- [ ] `SCHEDULE_SLOTS` configured
- [ ] `DEBUG_MODE` set to `"false"` for production

#### Telegram
- [ ] Bot added as admin to target channel
- [ ] Bot has Post Messages permission
- [ ] Webhook set and verified
- [ ] Bot responds to `/start` command

#### Verification
- [ ] `curl <WORKER_URL>/` returns `{"ok": true}`
- [ ] `curl <WORKER_URL>/health` returns `"status": "healthy"`
- [ ] `curl <WORKER_URL>/version` returns correct version
- [ ] `/debug` dashboard loads (with DEBUG_TOKEN)
- [ ] `/debug/api/ping` returns `{"ok": true}`
- [ ] `npx tsx scripts/verify-setup.ts <WORKER_URL> <DEBUG_TOKEN>` passes

#### Runtime (via Admin Panel)
- [ ] Scheduler enabled
- [ ] At least one content source per category enabled
- [ ] AI provider configured
- [ ] Quality threshold ≥ 60
- [ ] Test manual publish works (Manual → Send Category A)

---

## Local Development

### Setup

```bash
# Copy the example dev vars
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your actual keys
nano .dev.vars

# Start local dev server
npm run dev
```

### Testing Webhook Locally

Use [ngrok](https://ngrok.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/run-tunnels/local-as-a-service/) to expose your local server:

```bash
# Terminal 1: Start wrangler dev
npm run dev

# Terminal 2: Start tunnel
ngrok http 8787

# Terminal 3: Set webhook to tunnel URL
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<NGROK_URL>/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

---

## Monitoring

### View Live Logs

```bash
wrangler tail
```

### Monitor KV Usage

Check the Cloudflare dashboard:
- Workers & Pages > fredy > Storage > KV
- Free tier: 100,000 reads/day, 1,000 writes/day

### Monitor API Usage

| API | Dashboard | Free Tier Limit |
|---|---|---|
| Gemini | [aistudio.google.com](https://aistudio.google.com) | 15 RPM, 1,500/day |
| OpenRouter | [openrouter.ai/credits](https://openrouter.ai/credits) | 20 RPM, free models |
| NewsAPI | [newsapi.org/account](https://newsapi.org/account) | 100/day |
| NASA | n/a | 1,000/hr |
| GitHub | [github.com/settings/tokens](https://github.com/settings/tokens) | 5,000/hr |

---

## Troubleshooting

### Bot not responding to `/start`

1. Check webhook: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
2. Check for `last_error_message` in the response
3. Verify `WEBHOOK_SECRET` matches between Telegram and Cloudflare
4. Check Worker logs: `wrangler tail`

### `missingRequired` in /health

1. Check `wrangler secret list` — all secrets should be listed
2. Re-set any missing secrets: `wrangler secret put <NAME>`
3. Redeploy: `wrangler deploy`

### AI calls failing

1. Check `/debug/api/status` — verify `has_gemini` and `has_openrouter` are true
2. Test AI: `POST /debug/api/test/ai` (with DEBUG_TOKEN)
3. Check API quotas (Gemini free tier: 1,500/day)
4. Check `wrangler tail` for error messages

### KV write quota exceeded

1. Enable `DEBUG_MODE = "false"` (reduces KV writes from logging)
2. Check batched stats are working (stats flush every 10 increments)
3. Reduce posting frequency if needed

### Scheduler not publishing

1. Check `/health` — `status` should be `healthy`
2. Check admin panel → Scheduler → Enabled
3. Check admin panel → Stats → are slots firing?
4. Check `wrangler tail` for scheduler errors
5. Verify cron triggers are deployed: `wrangler deploy` output should show cron triggers

---

## Rollback

If something goes wrong:

1. **Disable scheduler** via admin panel (Settings → Scheduler → OFF)
2. **Enable maintenance mode** (Settings → Maintenance → ON)
3. **Check logs:** `wrangler tail`
4. **Redeploy previous version:**
   ```bash
   git checkout <previous-tag>
   wrangler deploy
   ```
5. **Clear queue** if needed: Debug → Clear Queue

---

## Cost Optimization

Fredy is designed to run entirely on free tiers:

| Resource | Free Tier | Fredy Usage |
|---|---|---|
| Cloudflare Workers | 100K req/day | ~5-10 req/day (cron + webhook) |
| KV reads | 100K/day | ~20-50/day (config + state) |
| KV writes | 1K/day | ~10-20/day (batched stats) |
| Gemini API | 1,500/day | ~4/day (4 posts/day) |
| OpenRouter | 20 RPM | ~4/day (fallback only) |
| NewsAPI | 100/day | ~1/day |
| NASA API | 1,000/hr | ~1/day |

**Total monthly cost: $0** ✅

---

## Final Goal Achievement

Fredy is:
- ✅ **Fully serverless** — runs on Cloudflare Workers, no servers to manage
- ✅ **Fully automated** — cron-driven scheduler, no human intervention needed
- ✅ **Cost optimized** — $0/month on free tiers
- ✅ **Fail-safe** — AI provider fallback, retry mechanism, dead-letter queue
- ✅ **Admin-controlled only** — all features require ADMIN_ID or DEBUG_TOKEN
- ✅ **Production ready** — deployed, tested, and documented

---

**Fredy** — *Curated developer content, automatically.* 🚀

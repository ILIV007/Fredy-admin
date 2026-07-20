# Fredy — Deployment Checklist

> Use this checklist before deploying Fredy to production. Each item must be ✅ before going live.

---

## 1. Cloudflare Setup

- [ ] Cloudflare account created (free tier is sufficient)
- [ ] Wrangler CLI installed: `npm install -g wrangler`
- [ ] Logged in: `wrangler login`
- [ ] KV namespace created: `wrangler kv namespace create SETTINGS`
- [ ] KV namespace ID copied to `wrangler.toml`
- [ ] Worker name set in `wrangler.toml` (default: `fredy`)

## 2. Telegram Setup

- [ ] Bot created via [@BotFather](https://t.me/BotFather)
- [ ] Bot token copied (will be set as `BOT_TOKEN` secret)
- [ ] Bot added as **administrator** to the target channel
- [ ] Bot has **Post Messages** permission enabled
- [ ] Bot has **Schedule Messages** permission enabled (optional but recommended)
- [ ] Your Telegram user ID obtained (via [@userinfobot](https://t.me/userinfobot))
- [ ] `ADMIN_ID` set in `wrangler.toml` `[vars]`

## 3. API Keys

- [ ] Google Gemini API key obtained from [aistudio.google.com](https://aistudio.google.com/apikey)
- [ ] OpenRouter API key obtained from [openrouter.ai/keys](https://openrouter.ai/keys)
- [ ] (Optional) GitHub token for higher rate limit
- [ ] (Optional) NewsAPI key from [newsapi.org](https://newsapi.org)
- [ ] (Optional) NASA API key from [api.nasa.gov](https://api.nasa.gov)

## 4. Secrets

Set all secrets via `wrangler secret put` or Cloudflare dashboard:

- [ ] `BOT_TOKEN` — **required**
- [ ] `GEMINI_API_KEY` — **required** (primary AI)
- [ ] `OPENROUTER_API_KEY` — **required** (fallback AI)
- [ ] `WEBHOOK_SECRET` — **required** (random string for webhook verification)
- [ ] `DEBUG_TOKEN` — **recommended** (random string for `/debug` protection)
- [ ] `GITHUB_TOKEN` — optional
- [ ] `NEWSAPI_KEY` — optional
- [ ] `NASA_API_KEY` — optional (DEMO_KEY works but is rate-limited)

## 5. Configuration

In `wrangler.toml` `[vars]`:

- [ ] `ADMIN_ID` — your Telegram user ID
- [ ] `TARGET_CHANNEL` — e.g., `@ILIVIR3`
- [ ] `FOOTER_TEXT` — e.g., `🌀 @ILIVIR3`
- [ ] `DEBUG_MODE` — set to `"false"` for production
- [ ] `DEFAULT_AI_PROVIDER` — `"openrouter"` or `"gemini"`
- [ ] `DEFAULT_LANGUAGE` — `"auto"`, `"en"`, or `"fa"`
- [ ] `SCHEDULER_TIMEZONE` — your IANA timezone (e.g., `"Asia/Tehran"`)
- [ ] `SCHEDULE_SLOTS` — comma-separated times (e.g., `"09:00,13:00,18:00,22:00"`)
- [ ] `SCHEDULE_JITTER_MINUTES` — e.g., `"30"`

## 6. Pre-Deploy Verification

- [ ] `npm install` completes without errors
- [ ] `npx tsc --noEmit` passes (TypeScript strict mode, **zero errors** — not 33, ZERO)
- [ ] `VERSION` file, `src/core/constants.ts` (`APP_VERSION`), and `package.json` (`"version"`) all have the same version number
- [ ] `wrangler.toml` has correct KV namespace ID
- [ ] All secrets are set (verify with `wrangler secret list`)
- [ ] No API keys or secrets in `wrangler.toml` `[vars]` (only non-sensitive config)
- [ ] `.gitignore` includes `node_modules/`, `.wrangler/`, `.dev.vars`

## 6.5. Scheduling & Operational Risks

- [ ] **External cron configured**: cron-job.org (or equivalent) calls `POST /internal/tick` every 2 hours with `Authorization: Bearer <CRON_KEY>`
- [ ] **Backup cron active**: `wrangler.toml` has `crons = ["0 */24 * * *"]` (fires every 24h as safety net)
- [ ] **⚠️ Single point of failure acknowledged**: if cron-job.org goes down, posts may be delayed up to 24h. Set up an **uptime monitor** on `/internal/tick` that alerts the admin via a **separate channel** (not this bot) if it stops receiving 200 responses.
- [ ] **Dedup store cleared** (if upgrading from a version with hash collision bugs — e.g., v6.7.0 or earlier): call `POST /Manager/api/clear/dedup` once after deploy to remove stale `sha1("")` records.

## 7. Deploy

- [ ] Run `npx wrangler deploy`
- [ ] Note the Worker URL (e.g., `https://fredy.your-subdomain.workers.dev`)
- [ ] Set webhook:
  ```bash
  curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<WORKER_URL>/webhook&secret_token=<WEBHOOK_SECRET>"
  ```
- [ ] Verify webhook is set:
  ```bash
  curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
  ```

## 8. Post-Deploy Verification

- [ ] **Health check**: `curl https://<WORKER_URL>/` → returns JSON with `ok: true`
- [ ] **Ping**: `curl https://<WORKER_URL>/debug/api/ping` → returns `ok: true`
- [ ] **Status**: `curl https://<WORKER_URL>/debug/api/status` → all env vars present
- [ ] **Telegram test**: send `/start` to the bot → admin panel appears
- [ ] **Command test**: send `/help` → command list appears
- [ ] **Permission check**: send `/checkperms` → permissions OK
- [ ] **Debug dashboard**: visit `https://<WORKER_URL>/debug` in browser → dashboard loads

## 9. Runtime Configuration (via Admin Panel)

After deployment, configure these via the Telegram admin panel (`/start` → Settings):

- [ ] Enable scheduler (Settings → Scheduler → Enable)
- [ ] Configure category quotas (Categories → A/B/C daily limits)
- [ ] Enable/disable content sources (Providers → toggle plugins)
- [ ] Set AI provider preferences (AI → primary/fallback)
- [ ] Set quality threshold (AI → Quality stepper, default 60)
- [ ] Verify language settings (Settings → Language)

## 10. Go-Live Checklist

- [ ] Scheduler is enabled
- [ ] At least one content source per category is enabled
- [ ] AI providers are configured (at least one API key set)
- [ ] Quality threshold is ≥ 60
- [ ] Debug mode is OFF (`DEBUG_MODE = "false"`)
- [ ] Webhook secret is verified
- [ ] Debug token is set (to protect `/debug`)
- [ ] First test publish works (Manual → Send Category A)
- [ ] History records the published post (Stats → view today's posts)

## 11. Monitoring

- [ ] Check Cloudflare Workers logs: `npx wrangler tail`
- [ ] Monitor KV usage in Cloudflare dashboard (free tier: 100K reads/day, 1K writes/day)
- [ ] Monitor AI API usage (Gemini: 15 RPM/1500/day free; OpenRouter: 20 RPM free)
- [ ] Watch for "All providers failed" errors in logs (AI quota exhausted)
- [ ] Watch for "KV write quota" warnings (batched stats should prevent this)

## 12. Rollback Plan

If something goes wrong:

1. **Disable scheduler** via admin panel (Settings → Scheduler → OFF)
2. **Enable maintenance mode** (Settings → Maintenance → ON) — stops auto-publishing
3. **Check logs**: `npx wrangler tail`
4. **Redeploy previous version**: `git checkout <previous-tag> && npx wrangler deploy`
5. **Clear queue** if needed: Debug → Clear Queue

---

**Once all items are ✅, Fredy is production-ready.** 🚀

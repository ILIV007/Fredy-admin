# Fredy v3.3.0 — Deployment Instructions

## What's Fixed in v3.3.0

### 1. Build Errors (all 4 Cloudflare build failures fixed)
- ✅ Removed duplicate `const scheduler` declaration in `container.ts`
- ✅ Fixed `*/15` JSDoc comment bug in `cron.ts`
- ✅ Fixed `await` inside non-async arrow function in `daily-planner.ts`
- ✅ Removed duplicate `DEFAULT_RETRY_OPTIONS` export in `retry-manager.ts`
- ✅ Fixed `**/*.test.ts` JSDoc comment bug in `test-units.ts`

### 2. ALL 12 Plugins Now Have Real API Implementations
Previously, every plugin was a STUB that returned an empty array `[]`. Now they all
make real API calls with proper User-Agent headers, KV caching, and error handling:

| Plugin | API | Notes |
|--------|-----|-------|
| GitHub | api.github.com/search/repositories | Trending by topic, uses GITHUB_TOKEN |
| GitHub Releases | api.github.com/repos/.../releases/latest | Polls 15 popular repos |
| GitHub Trending | api.github.com/search/repositories | Most-starred in last 7 days |
| Dev.to | dev.to/api/articles | Top articles, 7d cache |
| Stack Exchange | api.stackexchange.com/2.3/questions | Top by random tag |
| Reddit | reddit.com/r/.../top.json | Rotating programming subs |
| NewsAPI | newsapi.org/v2/top-headlines | Tech category, needs NEWSAPI_KEY |
| Hacker News | hacker-news.firebaseio.com/v0 | Top stories, score > 50 |
| NASA APOD | api.nasa.gov/planetary/apod | Uses NASA_API_KEY or DEMO_KEY |
| JokeAPI | v2.jokeapi.dev/joke/Programming | Safe-mode, twopart |
| XKCD | xkcd.com/info.json | Latest comic |
| Wikimedia | en.wikipedia.org/api/rest_v1 | Today in tech history, proper UA fixes 403 |

### 3. Tick Endpoint Non-Blocking (fixes cron-job.org 30s timeout)
`/internal/tick` now returns `200 OK` immediately after authentication + lock acquisition.
All heavy work (scheduler tick, queue maintenance, source refresh, AI generation) runs
in `ctx.waitUntil()` in the background. The last tick log is persisted to KV for debugging.

### 4. Manager Dashboard — "Test Everything" Button
The Dashboard now has a prominent **🚀 Quick Test Everything** section at the top:
- Click **▶️ Test Everything** — runs all 9 system checks + 12 plugin tests + AI test
- Returns ONE comprehensive copyable JSON report (no more one-by-one testing!)
- Includes section-by-section summary table + plugin detail table
- "📋 Copy Full Report" button for sharing

### 5. Version Updated Everywhere (2.2.0 → 3.3.0)
- `src/entry/health.ts`
- `src/entry/manager.ts` (3 places: health endpoint, system endpoint, About page)
- `src/admin/screens/main.ts` (bot /menu)
- `package.json`
- `VERSION` file

---

## How to Deploy

### Option A: Push to Git (recommended)

1. **Unzip** `fredy-v3.3.0.zip` locally — you'll get a `fredy-admin/` folder.

2. **Replace your entire git repo** with this folder's contents:
   ```bash
   cd your-git-repo-folder
   # Delete everything (except .git)
   find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
   # Copy new files
   cp -r /path/to/fredy-admin/* .
   cp /path/to/fredy-admin/.editorconfig .  # if any hidden files
   ```

3. **Commit & push**:
   ```bash
   git add -A
   git commit -m "v3.3.0: fix build errors, implement all plugins, non-blocking tick, Test Everything"
   git push origin main
   ```

4. **Cloudflare Workers Builds** will auto-deploy on push. The build will succeed this time.

### Option B: Deploy with Wrangler CLI

```bash
cd fredy-admin
bun install   # or npm install
npx wrangler deploy
```

---

## Post-Deployment Verification

1. **Health check**: `https://fredy-admin.iliv007-34b.workers.dev/health`
   → should show `"version":"3.3.0"`

2. **Manager dashboard**: `https://fredy-admin.iliv007-34b.workers.dev/Manager`
   → Dashboard shows "Test Everything" button at top
   → Version shows "3.3.0"

3. **Click "Test Everything"** → should run all tests and show:
   - System: OK
   - KV: OK
   - Config: OK
   - Telegram: OK (assuming BOT_TOKEN set)
   - AI: OK or FAIL (depending on GEMINI_API_KEY/OPENROUTER_API_KEY)
   - Plugins: ~10/12 OK (some may fail if API keys missing, e.g. NewsAPI needs NEWSAPI_KEY)
   - Queue/Scheduler/History: OK

4. **Tick endpoint** (test from cron-job.org or curl):
   ```bash
   curl "https://fredy-admin.iliv007-34b.workers.dev/internal/tick?key=QWERTasdf1234ZXCVrfvb7654"
   ```
   → Should return immediately with `{"ok":true,"log":["tick started: running in background"]}`

5. **Bot /menu**: should show `Version: 3.3.0`

---

## Secrets Still Needed

Some plugins require API keys to work. Check Manager → Dashboard → Secrets panel:

| Secret | Required by | How to get |
|--------|-------------|-----------|
| `BOT_TOKEN` | Telegram bot | @BotFather |
| `GEMINI_API_KEY` | AI generation (primary) | https://aistudio.google.com/apikey |
| `OPENROUTER_API_KEY` | AI generation (fallback) | https://openrouter.ai/keys |
| `CRON_KEY` | Tick endpoint auth | Already set: `QWERTasdf1234ZXCVrfvb7654` |
| `NEWSAPI_KEY` | NewsAPI plugin | https://newsapi.org/register |
| `NASA_API_KEY` | NASA APOD plugin (optional, DEMO_KEY works) | https://api.nasa.gov |
| `GITHUB_TOKEN` | GitHub plugins (optional, 60/hr without) | https://github.com/settings/tokens |
| `WEBHOOK_SECRET` | Webhook verification | Random string |
| `DEBUG_TOKEN` | Manager/Debug dashboard auth | Random string |
| `ADMIN_ID` | Bot admin identification | Your Telegram user ID (numeric) |

Set secrets via Cloudflare dashboard or:
```bash
npx wrangler secret put NEWSAPI_KEY
npx wrangler secret put NASA_API_KEY
npx wrangler secret put GITHUB_TOKEN
```

---

## Wrangler Config Note

`wrangler.toml` has `name = "fredy-admin"` which matches your Cloudflare Worker name.
The Cloudflare Workers Builds warning about name mismatch should disappear.

The `[triggers] crons = [...]` are kept for fallback. If you only want external
cron-job.org to trigger ticks, you can comment out the `[triggers]` section to
avoid double execution.

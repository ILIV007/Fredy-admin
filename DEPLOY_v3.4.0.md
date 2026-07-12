# Fredy v3.4.0 — راهنمای دیپلوی

## ✅ چی fix شد در v3.4.0

### باگ‌های بحرانی runtime (۱۱ باگ):

1. **KV binding mismatch** — `env.SETTINGS` → `env.Fredy_SETTINGS` (۴ فایل)
2. **Scheduler dequeue type** — extract `.content` از QueuedContent
3. **Missing queueMin/queueTarget** — ۶ فیلد به ContentConfig اضافه شد
4. **Missing CRON_KEY** — به Env type اضافه شد
5. **Missing approveMode** — به FredySettings type اضافه شد
6. **`/menu` command not registered** — export و register شد
7. **`scheduledTime` → `epochMs`** — در schedule.ts screen
8. **Scheduler disabled by default** — `enabled: true` شد
9. **telegramDefaults.adminId validation fail** — `min(1)` → `default("")`
10. **AI providers not filtered by isConfigured** — filter اضافه شد
11. **Outdated/fictional AI models** — مدل‌های واقعی جایگزین شد

### تنظیمات پیش‌فرض ربات:
- ✅ Scheduler: **فعال** (۴ اسلات: ۰۹:۰۰، ۱۳:۰۰، ۱۸:۰۰، ۲۲:۰۰)
- ✅ Bot: **فعال**
- ✅ Categories: A (۲ پست/روز), B (۱), C (۱) — همه فعال
- ✅ AI Provider: OpenRouter (اصلی) + Gemini (fallback)
- ✅ Language: auto (انگلیسی + فارسی)
- ✅ Quality: minScore 60, duplicate detection, spam protection
- ✅ Queue: min 2/1/1, target 4/2/2 برای A/B/C
- ✅ Timezone: Asia/Tehran
- ✅ Channel: @ILIVIR3

## 🚀 نحوه دیپلوی

### مرحله ۱: آماده‌سازی
1. فایل `fredy-v3.4.0.zip` را دانلود کنید
2. Extract کنید → پوشه `Fredy-admin/`

### مرحله ۲: Push به Git

**مهم:** اول کلون محلی خودتان را پاک و تمیز کنید:

```bash
# به کلون محلی خودتان بروید
cd /path/to/your/Fredy-admin-clone

# تمام فایل‌های قدیمی را پاک کنید (به جز .git)
# روی مک/لینوکس:
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# روی ویندوز PowerShell:
Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force

# فایل‌های جدید را از پوشه استخراج‌شده کپی کنید
# (تمام فایل‌های داخل Fredy-admin/ به جز .git اگر دارید)
cp -a /path/to/extracted/Fredy-admin/. ./
# یا با File Explorer کپی کنید
```

### مرحله ۳: Commit و Push

```bash
git add -A
git commit -m "v3.4.0: fix 11 critical bugs, configure all defaults"
git push origin main
```

اگر خطای conflict گرفتید:
```bash
git push --force origin main
```

### مرحله ۴: بررسی
- به GitHub بروید: `https://github.com/ILIV007/Fredy-admin`
- فایل `src/container.ts` را باز کنید
- باید `env.Fredy_SETTINGS` ببینید (نه `env.SETTINGS`)
- Cloudflare Workers Builds خودکار build می‌کند

## 📋 Secrets مورد نیاز

| Secret | ضروری | کاربرد |
|--------|-------|--------|
| `BOT_TOKEN` | ✅ | Telegram bot |
| `GEMINI_API_KEY` | ✅ | AI (fallback) |
| `OPENROUTER_API_KEY` | ✅ | AI (اصلی) |
| `CRON_KEY` | ✅ | احراز هویت tick endpoint |
| `ADMIN_ID` | ✅ | شناسه Telegram admin (numeric) |
| `NEWSAPI_KEY` | اختیاری | پلاگین اخبار |
| `NASA_API_KEY` | اختیاری | پلاگین NASA |
| `GITHUB_TOKEN` | اختیاری | GitHub rate limit |

## 🔍 بررسی بعد از دیپلوی

1. **Health**: `https://fredy-admin.iliv007-34b.workers.dev/health`
   - باید `version: "3.4.0"` ببینید

2. **Manager**: `https://fredy-admin.iliv007-34b.workers.dev/Manager`
   - دکمه "Test Everything" را بزنید
   - باید بیشتر تست‌ها OK بگذرد

3. **Bot**: در تلگرام `/menu` بزنید
   - باید داشبورد با Version 3.4.0 ببینید

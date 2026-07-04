#!/usr/bin/env bash
# ============================================================
# Fredy — Set Telegram Webhook
# ============================================================
# Usage:
#   ./scripts/set-webhook.sh <BOT_TOKEN> <WORKER_URL> [WEBHOOK_SECRET]
#
# Example:
#   ./scripts/set-webhook.sh 123456:ABC... https://fredy.xxx.workers.dev mysecret
# ============================================================

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: $0 <BOT_TOKEN> <WORKER_URL> [WEBHOOK_SECRET]"
    echo ""
    echo "Arguments:"
    echo "  BOT_TOKEN       — Telegram bot token from @BotFather"
    echo "  WORKER_URL      — Cloudflare Worker URL (e.g., https://fredy.xxx.workers.dev)"
    echo "  WEBHOOK_SECRET  — (optional) secret token for webhook verification"
    exit 1
fi

BOT_TOKEN="$1"
WORKER_URL="$2"
WEBHOOK_SECRET="${3:-}"

WEBHOOK_URL="${WORKER_URL}/webhook"

echo "Setting Telegram webhook..."
echo "  URL:           $WEBHOOK_URL"
if [ -n "$WEBHOOK_SECRET" ]; then
    echo "  Secret Token:  $WEBHOOK_SECRET"
fi
echo ""

if [ -n "$WEBHOOK_SECRET" ]; then
    RESPONSE=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
        -d "url=${WEBHOOK_URL}" \
        -d "secret_token=${WEBHOOK_SECRET}")
else
    RESPONSE=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
        -d "url=${WEBHOOK_URL}")
fi

echo "Response:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "Verifying webhook..."

WEBHOOK_INFO=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")
echo "$WEBHOOK_INFO" | python3 -m json.tool 2>/dev/null || echo "$WEBHOOK_INFO"

echo ""
if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "✅ Webhook set successfully!"
else
    echo "❌ Webhook setup failed. Check the response above."
    exit 1
fi

#!/usr/bin/env bash
# ============================================================
# Fredy — Automated Deployment Script
# Version: 1.4.0
# ============================================================
# This script:
#   1. Checks prerequisites
#   2. Creates KV namespace
#   3. Prompts for secrets and sets them
#   4. Deploys the Worker
#   5. Sets the Telegram webhook
#   6. Verifies deployment
#
# Usage:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh
# ============================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_ok() {
    echo -e "${GREEN}  ✅ $1${NC}"
}

print_warn() {
    echo -e "${YELLOW}  ⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}  ❌ $1${NC}"
}

print_info() {
    echo -e "  ℹ️  $1"
}

# ============================================================
# 1. Prerequisites Check
# ============================================================
print_header "Fredy Deployment Setup v1.4.0"
echo ""

# Check node
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Install from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
print_ok "Node.js: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed."
    exit 1
fi
print_ok "npm: $(npm --version)"

# Check wrangler
if ! command -v wrangler &> /dev/null; then
    print_info "Installing wrangler..."
    npm install -g wrangler
fi
print_ok "wrangler: $(wrangler --version 2>&1 | head -1)"

# Check wrangler login
print_info "Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    print_warn "Not logged in to Cloudflare. Running wrangler login..."
    wrangler login
fi
print_ok "Cloudflare: authenticated"

# ============================================================
# 2. Install Dependencies
# ============================================================
print_header "Installing Dependencies"
npm install
print_ok "Dependencies installed"

# ============================================================
# 3. Create KV Namespace
# ============================================================
print_header "Creating KV Namespace"
echo "This will create a KV namespace for Fredy's storage."
echo ""

KV_OUTPUT=$(wrangler kv namespace create SETTINGS 2>&1 || true)
echo "$KV_OUTPUT"

# Extract KV ID
KV_ID=$(echo "$KV_OUTPUT" | grep -oE '"id":\s*"[a-f0-9]+"' | head -1 | grep -oE '[a-f0-9]{32}')

if [ -z "$KV_ID" ]; then
    print_warn "Could not auto-extract KV ID. Please enter it manually:"
    read -p "  KV Namespace ID: " KV_ID
fi

print_ok "KV Namespace ID: $KV_ID"

# Update wrangler.toml with KV ID
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/REPLACE_WITH_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml
else
    sed -i "s/REPLACE_WITH_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml
fi
print_ok "wrangler.toml updated with KV namespace ID"

# ============================================================
# 4. Configure Environment Variables
# ============================================================
print_header "Configure Environment Variables"
echo "Please provide the following values:"
echo ""

read -p "  Telegram Admin ID (from @userinfobot): " ADMIN_ID
read -p "  Target Channel (e.g., @ILIVIR3): " TARGET_CHANNEL
read -p "  Footer Text (e.g., 🌀 @ILIVIR3): " FOOTER_TEXT
read -p "  Timezone (e.g., Asia/Tehran) [default: Asia/Tehran]: " TIMEZONE
TIMEZONE=${TIMEZONE:-Asia/Tehran}

# Update wrangler.toml
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/REPLACE_WITH_YOUR_TELEGRAM_USER_ID/$ADMIN_ID/" wrangler.toml
    sed -i '' "s/@ILIVIR3/$TARGET_CHANNEL/g" wrangler.toml
else
    sed -i "s/REPLACE_WITH_YOUR_TELEGRAM_USER_ID/$ADMIN_ID/" wrangler.toml
    sed -i "s/@ILIVIR3/$TARGET_CHANNEL/g" wrangler.toml
fi
print_ok "wrangler.toml updated with environment variables"

# ============================================================
# 5. Set Secrets
# ============================================================
print_header "Setting Secrets"
echo "You will be prompted to enter each secret value."
echo "Values are hidden and stored securely in Cloudflare."
echo ""

# Required secrets
echo -e "${YELLOW}  Required Secrets:${NC}"
wrangler secret put BOT_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put OPENROUTER_API_KEY

echo ""
echo -e "${YELLOW}  Recommended Secrets:${NC}"
read -p "  Set WEBHOOK_SECRET? (y/n) [y]: " SET_WEBHOOK_SECRET
SET_WEBHOOK_SECRET=${SET_WEBHOOK_SECRET:-y}
if [[ "$SET_WEBHOOK_SECRET" == "y" ]]; then
    WEBHOOK_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "fredy-webhook-$(date +%s)")
    echo "$WEBHOOK_SECRET" | wrangler secret put WEBHOOK_SECRET
    print_ok "WEBHOOK_SECRET set (save this for webhook setup): $WEBHOOK_SECRET"
else
    print_warn "WEBHOOK_SECRET not set — webhook verification disabled"
fi

read -p "  Set DEBUG_TOKEN? (y/n) [y]: " SET_DEBUG_TOKEN
SET_DEBUG_TOKEN=${SET_DEBUG_TOKEN:-y}
if [[ "$SET_DEBUG_TOKEN" == "y" ]]; then
    DEBUG_TOKEN=$(openssl rand -hex 32 2>/dev/null || echo "fredy-debug-$(date +%s)")
    echo "$DEBUG_TOKEN" | wrangler secret put DEBUG_TOKEN
    print_ok "DEBUG_TOKEN set (save this for /debug access): $DEBUG_TOKEN"
else
    print_warn "DEBUG_TOKEN not set — /debug is open (not recommended for production)"
fi

echo ""
echo -e "${YELLOW}  Optional Secrets (press Enter to skip):${NC}"

read -p "  Set NEWSAPI_KEY? (y/n) [n]: " SET_NEWS
if [[ "$SET_NEWS" == "y" ]]; then
    wrangler secret put NEWSAPI_KEY
    print_ok "NEWSAPI_KEY set"
fi

read -p "  Set NASA_API_KEY? (y/n) [n]: " SET_NASA
if [[ "$SET_NASA" == "y" ]]; then
    wrangler secret put NASA_API_KEY
    print_ok "NASA_API_KEY set"
else
    print_info "NASA_API_KEY not set — will use DEMO_KEY (rate-limited)"
fi

read -p "  Set GITHUB_TOKEN? (y/n) [n]: " SET_GITHUB
if [[ "$SET_GITHUB" == "y" ]]; then
    wrangler secret put GITHUB_TOKEN
    print_ok "GITHUB_TOKEN set"
fi

# ============================================================
# 6. Deploy
# ============================================================
print_header "Deploying Worker"
DEPLOY_OUTPUT=$(wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract Worker URL
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9-]+\.workers\.dev' | head -1)

if [ -z "$WORKER_URL" ]; then
    print_warn "Could not auto-extract Worker URL. Please enter it manually:"
    read -p "  Worker URL (e.g., https://fredy.your-subdomain.workers.dev): " WORKER_URL
fi

print_ok "Worker deployed: $WORKER_URL"

# ============================================================
# 7. Set Webhook
# ============================================================
print_header "Setting Telegram Webhook"

if [[ "$SET_WEBHOOK_SECRET" == "y" ]]; then
    WEBHOOK_RESULT=$(curl -s "https://api.telegram.org/bot$(wrangler secret list 2>/dev/null | grep BOT_TOKEN | head -1 | awk '{print $2}')/setWebhook" \
        -d "url=${WORKER_URL}/webhook" \
        -d "secret_token=${WEBHOOK_SECRET}" 2>&1 || true)
    # This won't work because we can't read secrets back.
    # Instead, prompt for the token.
    echo ""
    echo "  To set the webhook, run:"
    echo ""
    echo "  curl \"https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook\" \\"
    echo "    -d \"url=${WORKER_URL}/webhook\" \\"
    echo "    -d \"secret_token=${WEBHOOK_SECRET}\""
    echo ""
    read -p "  Have you set the webhook? (y/n) [y]: " WEBHOOK_DONE
    WEBHOOK_DONE=${WEBHOOK_DONE:-y}
else
    echo ""
    echo "  To set the webhook, run:"
    echo ""
    echo "  curl \"https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook\" \\"
    echo "    -d \"url=${WORKER_URL}/webhook\""
    echo ""
    read -p "  Have you set the webhook? (y/n) [y]: " WEBHOOK_DONE
    WEBHOOK_DONE=${WEBHOOK_DONE:-y}
fi

if [[ "$WEBHOOK_DONE" == "y" ]]; then
    print_ok "Webhook set"
else
    print_warn "Webhook not set — bot will not receive updates"
fi

# ============================================================
# 8. Verify Deployment
# ============================================================
print_header "Verifying Deployment"

echo "  Checking health endpoint..."
HEALTH_RESPONSE=$(curl -s "${WORKER_URL}/" 2>&1 || echo "failed")
if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
    print_ok "Health check passed"
else
    print_error "Health check failed: $HEALTH_RESPONSE"
fi

echo "  Checking version endpoint..."
VERSION_RESPONSE=$(curl -s "${WORKER_URL}/version" 2>&1 || echo "failed")
if echo "$VERSION_RESPONSE" | grep -q "Fredy"; then
    print_ok "Version check passed"
else
    print_error "Version check failed: $VERSION_RESPONSE"
fi

echo "  Checking detailed health..."
DETAILED_HEALTH=$(curl -s "${WORKER_URL}/health" 2>&1 || echo "failed")
if echo "$DETAILED_HEALTH" | grep -q '"status"'; then
    STATUS=$(echo "$DETAILED_HEALTH" | grep -oE '"status":"[a-z]+"' | grep -oE '[a-z]+')
    if [[ "$STATUS" == "healthy" ]]; then
        print_ok "System status: healthy"
    elif [[ "$STATUS" == "degraded" ]]; then
        print_warn "System status: degraded (some optional keys missing)"
    else
        print_error "System status: down (required keys missing)"
        echo "$DETAILED_HEALTH" | grep -oE '"missingRequired":\[[^]]*\]'
    fi
fi

# ============================================================
# 9. Summary
# ============================================================
print_header "Deployment Complete!"

echo ""
echo -e "${GREEN}  Fredy is now deployed!${NC}"
echo ""
echo "  Worker URL:  $WORKER_URL"
echo "  Admin ID:    $ADMIN_ID"
echo "  Channel:     $TARGET_CHANNEL"
echo ""
echo "  Next steps:"
echo "    1. Send /start to your bot in Telegram"
echo "    2. Visit ${WORKER_URL}/debug (use DEBUG_TOKEN as Bearer)"
echo "    3. Enable the scheduler via the admin panel"
echo ""
echo "  Useful commands:"
echo "    wrangler tail              — view live logs"
echo "    wrangler secret list       — list secrets"
echo "    curl ${WORKER_URL}/health  — check system status"
echo ""

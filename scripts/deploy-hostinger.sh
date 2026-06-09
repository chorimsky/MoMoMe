#!/usr/bin/env bash
# ============================================================
# Deploy the frontend to Hostinger PRODUCTION (momome.xyz) — the LIVE site.
#
# Workflow:
#   1. git push           → Vercel auto-deploys (test on the vercel.app URL)
#   2. scripts/deploy-hostinger.sh  → builds + ships to Hostinger (go live)
#
# Requires the SSH deploy key (already authorised on the server). Override any
# target via env vars if it ever changes.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_HOST="${HOSTINGER_HOST:-92.112.182.63}"
SSH_PORT="${HOSTINGER_PORT:-65002}"
SSH_USER="${HOSTINGER_USER:-u739778915}"
WEB_ROOT="${HOSTINGER_WEBROOT:-domains/momome.xyz/public_html}"
API_BASE="${VITE_API_BASE:-https://momome-api-production.up.railway.app/api}"
SITE="${SITE_URL:-https://momome.xyz}"

echo "──────────────────────────────────────────────"
echo " Deploy → Hostinger PRODUCTION ($SITE)"
echo "   API  = $API_BASE"
echo "   host = $SSH_USER@$SSH_HOST:$WEB_ROOT"
echo "──────────────────────────────────────────────"

# Full build (tsc --noEmit + vite + SEO). A type error aborts the deploy.
VITE_API_BASE="$API_BASE" SITE_URL="$SITE" pnpm --filter @momome/app build
[ -f app/dist/.htaccess ] || cp app/public/.htaccess app/dist/.htaccess

echo "Uploading…"
# No --delete (safe): overwrites changed files, leaves Hostinger-managed files
# (e.g. .well-known/acme-challenge for SSL) untouched.
rsync -rz --stats -e "ssh -p $SSH_PORT -o BatchMode=yes" \
  app/dist/ "$SSH_USER@$SSH_HOST:$WEB_ROOT/" 2>&1 \
  | grep -iE "Number of files transferred|Total transferred file size" || true

echo "Verifying…"
LIVE=$(curl -s "$SITE/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
LOCAL="assets/$(basename app/dist/assets/index-*.js)"
if [ "$LIVE" = "$LOCAL" ]; then
  echo "✅ LIVE on $SITE — serving $LIVE"
else
  echo "⚠️  live=$LIVE  local=$LOCAL  (LiteSpeed cache may take a minute to catch up)"
fi

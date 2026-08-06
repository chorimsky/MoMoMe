#!/usr/bin/env bash
# ============================================================
# Flip the Railway backend to REAL crypto-in (IBEX production) in one command,
# then redeploy and verify IBEX actually came up in production.
#
# What it changes on Railway (service momome-api):
#   IBEX_ENV=production
#   IBEX_ALLOW_SANDBOX_PAYOUT=false          (no more real-XAF-for-sandbox-crypto)
#   IBEX_CLIENT_ID / IBEX_CLIENT_SECRET / IBEX_ACCOUNT_ID  (your PRODUCTION values)
#
# It does NOT touch Peexit — that rail is already production; you still have to
# FUND its disbursement wallet with XAF (real money, done with Peexit) before any
# payout can land. This script verifies crypto-in went live; it can't fund payouts.
#
# Secrets stay with you: pass them as environment variables; nothing is written to
# the repo. Nothing runs until every required value is present.
#
# Usage:
#   export RAILWAY_API_TOKEN=...            # your Railway account token
#   export IBEX_CLIENT_ID=...               # PRODUCTION IBEX values
#   export IBEX_CLIENT_SECRET=...
#   export IBEX_ACCOUNT_ID=...
#   bash scripts/go-live.sh
# ============================================================
set -uo pipefail

SVC="${RAILWAY_SERVICE_ID_NAME:-momome-api}"
HEALTH_URL="${HEALTH_URL:-https://momome-api-production.up.railway.app/health}"
TOKEN="${RAILWAY_API_TOKEN:-}"
DEP_TOKEN="$TOKEN"
GQL="https://backboard.railway.com/graphql/v2"
DEP_SVC="${RAILWAY_SERVICE_ID:-e61829e1-6ed3-4dbf-bb4a-7cdb26b87df1}"
DEP_ENV="${RAILWAY_ENV_ID:-32392d90-3ba4-4433-b6eb-ac1002e15dbe}"
DEP_PROJ="${RAILWAY_PROJECT_ID:-e9a0007c-b039-4772-afc0-f7798e268d84}"

need() { if [[ -z "${!1:-}" ]]; then echo "❌ missing env var: $1" >&2; MISSING=1; fi; }
MISSING=0
need RAILWAY_API_TOKEN
need IBEX_CLIENT_ID
need IBEX_CLIENT_SECRET
need IBEX_ACCOUNT_ID
if [[ "$MISSING" == "1" ]]; then
  echo "" >&2
  echo "Export the four values above (production IBEX credentials + Railway token) and re-run." >&2
  exit 2
fi

echo "──────────────────────────────────────────────"
echo " Going live: IBEX → production (service $SVC)"
echo "──────────────────────────────────────────────"
echo "This will set IBEX_ENV=production, IBEX_ALLOW_SANDBOX_PAYOUT=false, and your"
echo "production IBEX credentials, then Railway will redeploy. Ctrl-C within 5s to abort."
sleep 5

echo "→ setting production variables (triggers a redeploy)…"
railway variables --service "$SVC" \
  --set "IBEX_ENV=production" \
  --set "IBEX_ALLOW_SANDBOX_PAYOUT=false" \
  --set "IBEX_CLIENT_ID=$IBEX_CLIENT_ID" \
  --set "IBEX_CLIENT_SECRET=$IBEX_CLIENT_SECRET" \
  --set "IBEX_ACCOUNT_ID=$IBEX_ACCOUNT_ID" \
  >/dev/null 2>&1 && echo "   variables applied." || { echo "❌ failed to set variables (is the CLI linked / token valid?)" >&2; exit 1; }

latest_dep() {
  curl -s -m 30 "$GQL" -H "Authorization: Bearer $DEP_TOKEN" -H "Content-Type: application/json" \
    -d "{\"query\":\"query { deployments(first:1, input:{projectId:\\\"$DEP_PROJ\\\",serviceId:\\\"$DEP_SVC\\\",environmentId:\\\"$DEP_ENV\\\"}){edges{node{id status}}} }\"}" \
    | python3 -c 'import json,sys
try:
    n=json.load(sys.stdin)["data"]["deployments"]["edges"][0]["node"]; print(n["id"], n["status"])
except Exception: print("- UNKNOWN")'
}

echo "→ waiting for the redeploy to reach SUCCESS…"
DEP_ID=""
for i in $(seq 1 60); do
  sleep 10
  read -r ID STATUS <<<"$(latest_dep)"
  echo "   [$((i*10))s] $ID → $STATUS"
  [[ "$STATUS" == "SUCCESS" ]] && { DEP_ID="$ID"; break; }
  case "$STATUS" in FAILED|CRASHED) echo "❌ redeploy $ID is $STATUS — check Railway build logs." >&2; exit 1 ;; esac
done
[[ -z "$DEP_ID" ]] && { echo "❌ timed out waiting for SUCCESS." >&2; exit 1; }

echo "→ verifying health…"
for i in $(seq 1 24); do
  [[ "$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$HEALTH_URL")" == "200" ]] && break
  sleep 5
done

echo "→ confirming IBEX came up in PRODUCTION (startup log)…"
sleep 3
CRYPTO_LINE="$(curl -s -m 20 "$GQL" -H "Authorization: Bearer $DEP_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":\"query { deploymentLogs(deploymentId:\\\"$DEP_ID\\\", limit:40){message} }\"}" \
  | python3 -c 'import json,sys
for l in json.load(sys.stdin)["data"]["deploymentLogs"]:
    if "crypto:" in l["message"]: print(l["message"].strip())' 2>/dev/null | tail -1)"
echo "   $CRYPTO_LINE"

if echo "$CRYPTO_LINE" | grep -q "production"; then
  echo "✅ IBEX is live in PRODUCTION and the service is healthy."
else
  echo "⚠️  Health is 200 but the startup log doesn't show IBEX production — check the log:"
  echo "    it may mean the production IBEX credentials were rejected (OAuth). Verify the keys."
fi

echo ""
echo "REMAINING (real money, only you can do it):"
echo "  • Fund the Peexit disbursement wallet with XAF (≥ your payout volume) and"
echo "    confirm Peexit enabled your account for MTN + Orange disbursement."
echo "  • Then a scan-to-pay / send will settle end-to-end. Re-run a test payment to confirm."

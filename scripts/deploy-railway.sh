#!/usr/bin/env bash
# ============================================================
# Deploy the backend to Railway AND verify it actually went live.
#
# Why this exists: `railway up` frequently errors/times out on its RESPONSE from
# this environment even though the deployment succeeds server-side — so the CLI
# "failing" tells you nothing. This wrapper ignores that noise and instead polls
# the Railway API for the new deployment reaching SUCCESS and the public /health
# returning 200, then prints a clear ✅ / ❌. Mirrors scripts/deploy-hostinger.sh.
#
# Requires: RAILWAY_API_TOKEN in the environment (an account token).
# Optional overrides: RAILWAY_SERVICE_ID, RAILWAY_ENV_ID, RAILWAY_PROJECT_ID,
#                     HEALTH_URL.
# ============================================================
set -uo pipefail

TOKEN="${RAILWAY_API_TOKEN:-}"
SVC="${RAILWAY_SERVICE_ID:-e61829e1-6ed3-4dbf-bb4a-7cdb26b87df1}"   # momome-api
ENVI="${RAILWAY_ENV_ID:-32392d90-3ba4-4433-b6eb-ac1002e15dbe}"     # production
PROJ="${RAILWAY_PROJECT_ID:-e9a0007c-b039-4772-afc0-f7798e268d84}" # momome
HEALTH_URL="${HEALTH_URL:-https://momome-api-production.up.railway.app/health}"
GQL="https://backboard.railway.com/graphql/v2"

if [[ -z "$TOKEN" ]]; then
  echo "❌ RAILWAY_API_TOKEN is not set. Export it and re-run." >&2
  exit 2
fi

# GraphQL helper: $1 = query string → prints raw JSON.
gql() {
  curl -s -m 30 "$GQL" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1")"
}

latest_deploy() { # prints "<id> <status>" of the newest deployment
  gql "query { deployments(first: 1, input: { projectId: \"$PROJ\", serviceId: \"$SVC\", environmentId: \"$ENVI\" }) { edges { node { id status } } } }" \
    | python3 -c 'import json,sys
try:
    n=json.load(sys.stdin)["data"]["deployments"]["edges"][0]["node"]; print(n["id"], n["status"])
except Exception: print("- UNKNOWN")'
}

echo "──────────────────────────────────────────────"
echo " Deploying momome-api to Railway"
echo "──────────────────────────────────────────────"
BEFORE_ID="$(latest_deploy | awk '{print $1}')"
echo "current deployment: ${BEFORE_ID:-none}"

# Kick the deploy. The CLI's own exit/stream is unreliable here, so we don't trust
# it — capture output for context but press on to API verification regardless.
echo "→ railway up …"
railway up --ci --service momome-api 2>&1 | tail -3 || true

# 1) Wait for a NEW deployment to reach SUCCESS (or bail on FAILED/CRASHED).
echo "→ waiting for the new deployment to build & go live…"
DEPLOY_OK=""
for i in $(seq 1 60); do   # up to ~10 min
  sleep 10
  read -r ID STATUS <<<"$(latest_deploy)"
  # Only consider a deployment newer than the one we started from.
  if [[ -n "$ID" && "$ID" != "$BEFORE_ID" ]]; then
    echo "   [$((i*10))s] $ID → $STATUS"
    case "$STATUS" in
      SUCCESS) DEPLOY_OK="$ID"; break ;;
      FAILED|CRASHED|REMOVED) echo "❌ new deployment $ID is $STATUS." >&2; exit 1 ;;
    esac
  else
    echo "   [$((i*10))s] waiting for a new deployment to appear…"
  fi
done

if [[ -z "$DEPLOY_OK" ]]; then
  echo "❌ timed out waiting for a SUCCESS deployment." >&2
  exit 1
fi

# 2) Confirm the public health endpoint is actually serving 200.
echo "→ verifying $HEALTH_URL …"
for i in $(seq 1 24); do   # up to ~2 min
  CODE="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$HEALTH_URL")"
  if [[ "$CODE" == "200" ]]; then
    echo "✅ LIVE — deployment $DEPLOY_OK is SUCCESS and $HEALTH_URL returns 200."
    curl -s -m 8 "$HEALTH_URL"; echo
    exit 0
  fi
  echo "   [$((i*5))s] health=$CODE…"; sleep 5
done

echo "❌ deployment $DEPLOY_OK is SUCCESS but health never returned 200." >&2
exit 1

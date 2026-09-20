#!/usr/bin/env bash
# Deploy the settlement engine by hand, the same way CI does — a clean export of HEAD, stamped
# with its commit, uploaded to Railway, waited on, gated (deep health + synthetic quote, on the
# NEW build), and rolled back to the previous SUCCESS deployment when the gate fails.
#
#   scripts/deploy.sh [production|staging]        (default: production)
#
# Needs: a logged-in Railway CLI (`railway login`) or RAILWAY_TOKEN; for the automatic rollback
# a RAILWAY_API_TOKEN (account token) or RAILWAY_TOKEN — without one the script prints the
# deployment id to roll back to. Never run from a dirty tree expecting local edits to ship:
# only what is COMMITTED goes out (that is the point).
set -euo pipefail
TARGET="${1:-production}"
PROJECT="${RAILWAY_PROJECT_ID:-e9a0007c-b039-4772-afc0-f7798e268d84}"
SERVICE="${RAILWAY_SERVICE:-momome-api}"
case "$TARGET" in
  production) URL="${PRODUCTION_API_URL:-https://momome-api-production.up.railway.app}";;
  staging)    URL="${STAGING_API_URL:?STAGING_API_URL}";;
  *) echo "usage: $0 [production|staging]"; exit 2;;
esac
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
SHA=$(git rev-parse HEAD)
if [ -n "$(git status --porcelain | grep -v '^??')" ]; then
  echo "note: working tree has uncommitted changes — they will NOT be deployed (HEAD $SHA is)."
fi
ROOT=$(mktemp -d /tmp/momome-deploy.XXXXXX); trap 'rm -rf "$ROOT"' EXIT
git archive "$SHA" | tar -x -C "$ROOT"
printf '%s\n' "$SHA" > "$ROOT/BUILD_VERSION"      # what /health/deep will report as `version`
cd "$ROOT"
railway link -p "$PROJECT" -e "$TARGET" -s "$SERVICE" >/dev/null 2>&1 || true
PREV=$(railway deployment list --json 2>/dev/null | python3 -c 'import sys,json; d=[x for x in json.load(sys.stdin) if x.get("status")=="SUCCESS"]; print(d[0]["id"] if d else "")' 2>/dev/null || true)
echo "deploy: $TARGET ← ${SHA:0:7}  (previous SUCCESS: ${PREV:-none})"
OUT=$(railway up --detach 2>&1) || { echo "$OUT"; exit 1; }
ID=$(printf '%s' "$OUT" | grep -o 'id=[a-f0-9-]*' | head -1 | cut -d= -f2 || true)
echo "deploy: uploaded${ID:+ (deployment $ID)}"
# Wait for Railway's own verdict before probing — the old build answers until the new one is up.
for i in $(seq 1 60); do
  ST=$(railway deployment list --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); x=[e for e in d if e.get('id','')=='$ID'] if '$ID' else d[:1]; print(x[0]['status'] if x else '?')" 2>/dev/null || echo '?')
  case "$ST" in
    SUCCESS) echo "deploy: build+start SUCCESS"; break;;
    FAILED|CRASHED|REMOVED) echo "deploy: Railway reports $ST"; railway logs -d "$ID" 2>/dev/null | tail -40 || true; exit 1;;
  esac
  sleep 15
done
[ "${ST:-}" = "SUCCESS" ] || { echo "deploy: timed out waiting for Railway ($ST)"; exit 1; }
if bash "$REPO/scripts/deploy-gate.sh" "$URL" "$SHA"; then
  echo "deploy: ${SHA:0:7} is live and gated on $TARGET"
  exit 0
fi
echo "deploy: GATE FAILED for ${SHA:0:7}"
if [ -n "$PREV" ] && { [ -n "${RAILWAY_API_TOKEN:-}" ] || [ -n "${RAILWAY_TOKEN:-}" ]; }; then
  bash "$REPO/scripts/railway-rollback.sh" "$PREV" && echo "deploy: rolled back to $PREV"
else
  echo "deploy: roll back by hand → scripts/railway-rollback.sh $PREV  (needs RAILWAY_API_TOKEN)"
fi
exit 1

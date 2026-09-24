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
# Railway's API times out now and then; link is cheap, so insist on it.
for i in 1 2 3 4; do
  railway link -p "$PROJECT" -e "$TARGET" -s "$SERVICE" >/dev/null 2>&1 && railway status >/dev/null 2>&1 && break
  [ "$i" = 4 ] && { echo "deploy: could not link to Railway project $PROJECT ($TARGET/$SERVICE)"; exit 1; }
  sleep 5
done
PREV=$(railway deployment list --json 2>/dev/null | python3 -c 'import sys,json; d=[x for x in json.load(sys.stdin) if x.get("status")=="SUCCESS"]; print(d[0]["id"] if d else "")' 2>/dev/null || true)
echo "deploy: $TARGET ← ${SHA:0:7}  (previous SUCCESS: ${PREV:-none})"
# The upload times out on Railway's side often enough to be routine ("error sending request
# … operation timed out"), and it used to end the deploy. Retry — but never blindly: a client
# timeout does not prove the upload failed.
#
# What a deployment created SINCE THIS RUN STARTED is, is the only safe test. The previous
# version asked for "any deployment that is not PREV", which would also adopt a colleague's
# concurrent deploy, and it looked exactly once, ten seconds after the timeout — too soon.
# Both mattered on 2026-09-24: three attempts reported "nothing was deployed" while Railway
# had in fact received one and rejected it ("Failed to create code snapshot"), and the error
# that would have explained the whole thing was never shown.
START_EPOCH=$(( $(date -u +%s) - 5 ))   # small skew: clocks are not identical
# The newest deployment this run is responsible for, as `status<TAB>id<TAB>error`, or empty.
mine() {
  railway deployment list --json 2>/dev/null | python3 -c "
import sys, json
from datetime import datetime
start = float(sys.argv[1])
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
def when(x):
    try: return datetime.fromisoformat((x.get('createdAt') or '').replace('Z', '+00:00')).timestamp()
    except Exception: return 0.0
ours = [x for x in d if when(x) >= start]
if not ours: sys.exit(0)
x = max(ours, key=when)
err = '; '.join((x.get('meta') or {}).get('configErrors') or [])
print('\t'.join([x.get('status', '?'), x.get('id', ''), err]))" "$START_EPOCH" 2>/dev/null || true
}
ID=""
for i in 1 2 3; do
  OUT=$(railway up --detach 2>&1) && { ID=$(printf '%s' "$OUT" | grep -o 'id=[a-f0-9-]*' | head -1 | cut -d= -f2 || true); break; }
  echo "$OUT"
  # Give Railway time to register an upload the client gave up on: three looks, not one.
  FOUND=""
  for w in 1 2 3; do
    sleep 10
    FOUND=$(mine); [ -n "$FOUND" ] && break
  done
  if [ -n "$FOUND" ]; then
    D_ST=$(printf '%s' "$FOUND" | cut -f1); D_ID=$(printf '%s' "$FOUND" | cut -f2); D_ERR=$(printf '%s' "$FOUND" | cut -f3)
    case "$D_ST" in
      BUILDING|DEPLOYING|INITIALIZING|QUEUED|SUCCESS)
        ID="$D_ID"; echo "deploy: the upload timed out but Railway did receive it (deployment $ID)"; break;;
      *)
        # Received and rejected. Say so — and say WHY, which is the line that was missing.
        echo "deploy: Railway received attempt $i and rejected it ($D_ST${D_ERR:+ — $D_ERR})";;
    esac
  fi
  [ "$i" = 3 ] && {
    LAST=$(mine)
    if [ -n "$LAST" ]; then
      echo "deploy: giving up after three attempts. Railway's last word on this run: $(printf '%s' "$LAST" | cut -f1) $(printf '%s' "$LAST" | cut -f2) $(printf '%s' "$LAST" | cut -f3)"
    else
      echo "deploy: giving up after three attempts — Railway recorded no deployment for this run, so nothing was uploaded."
    fi
    exit 1
  }
  echo "deploy: upload attempt $i timed out, retrying"
done
echo "deploy: uploaded${ID:+ (deployment $ID)}"
# Wait for Railway's own verdict before probing — the old build answers until the new one is up.
for i in $(seq 1 60); do
  ST=$(railway deployment list --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); x=[e for e in d if e.get('id','')=='$ID'] if '$ID' else d[:1]; print(x[0]['status'] if x else '?')" 2>/dev/null || echo '?')
  case "$ST" in
    SUCCESS) echo "deploy: build+start SUCCESS"; break;;
    FAILED|CRASHED|REMOVED)
      echo "deploy: Railway reports $ST"
      # configErrors is where Railway puts the reason it refused the upload, and it is not in
      # the build logs at all — "Failed to create code snapshot" reads as a mystery without it.
      ERRS=$(railway deployment list --json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
x = next((e for e in d if e.get('id') == '$ID'), None)
print('; '.join((x.get('meta') or {}).get('configErrors') or []) if x else '')" 2>/dev/null || true)
      [ -n "$ERRS" ] && echo "deploy: Railway said → $ERRS"
      case "$ERRS" in
        *"code snapshot"*)
          # Railway's own message says "or try again": this is their ingest failing, not the
          # commit. Nothing was built, so re-running the script is safe and is the fix.
          echo "deploy: that is a transient Railway-side ingest fault, not a problem with ${SHA:0:7} — re-run this script.";;
      esac
      railway logs -d "$ID" 2>/dev/null | tail -40 || true
      exit 1;;
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

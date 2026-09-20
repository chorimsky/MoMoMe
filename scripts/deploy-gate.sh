#!/usr/bin/env bash
# Deploy gate — is the service that just came up fit to keep? Used by the CI deploy jobs and
# by hand after a manual `railway up`. Exits non-zero when it is not, so the caller can roll
# back (CI) or the operator can redeploy the previous build.
#   scripts/deploy-gate.sh https://momome-api-production.up.railway.app [expected-git-sha]
set -euo pipefail
BASE="${1:?base url}"; WANT="${2:-}"
echo "gate: waiting for $BASE/health/deep"
for i in $(seq 1 40); do
  body=$(curl -s -m 8 "$BASE/health/deep" || true)
  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$BASE/health/deep" || echo 000)
  ver=$(printf '%s' "$body" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("version") or "")
except Exception: print("")')
  # Every build now reports its commit (APP_VERSION from CI, or the BUILD_VERSION file that
  # scripts/deploy.sh stamps into the export). When a SHA is expected it has to MATCH: an
  # empty or different version means the previous build is still the one answering.
  if [ "$code" = "200" ] && { [ -z "$WANT" ] || [ "${WANT:0:7}" = "$ver" ]; }; then
    echo "gate: deep health OK (version ${ver:-?})"
    # A synthetic quote — the one call every customer path starts with.
    q=$(curl -s -m 10 -X POST "$BASE/api/quotes" -H 'content-type: application/json' -H 'x-mm-sender: deploy-gate' -d '{"xaf":5000,"method":"LIGHTNING","country":"CM"}' -o /dev/null -w '%{http_code}')
    if [ "$q" = "200" ] || [ "$q" = "201" ]; then echo "gate: synthetic quote OK"; exit 0; fi
    echo "gate: synthetic quote returned $q"; printf '%s\n' "$body"; exit 1
  fi
  sleep 15
done
echo "gate: FAILED — last response ($code):"; printf '%s\n' "$body"; exit 1

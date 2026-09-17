#!/usr/bin/env bash
# Roll a Railway service back to a specific deployment (the CLI's `redeploy` only redeploys
# the latest). Uses the public GraphQL API with RAILWAY_TOKEN (a project token) or an
# account token (RAILWAY_API_TOKEN).
#   scripts/railway-rollback.sh <deployment-id>
set -euo pipefail
ID="${1:?deployment id}"
if [ -n "${RAILWAY_TOKEN:-}" ]; then AUTH="Project-Access-Token: $RAILWAY_TOKEN"; else AUTH="Authorization: Bearer ${RAILWAY_API_TOKEN:?RAILWAY_TOKEN or RAILWAY_API_TOKEN}"; fi
curl -sf https://backboard.railway.com/graphql/v2 -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"query\":\"mutation { deploymentRollback(id: \\\"$ID\\\") }\"}" | python3 -c 'import sys,json
d=json.load(sys.stdin)
if d.get("errors"): print("rollback FAILED:", d["errors"]); sys.exit(1)
print("rollback requested:", d.get("data"))'

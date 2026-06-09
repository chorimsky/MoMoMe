#!/usr/bin/env bash
# ============================================================
# Build the MoMo›Me FRONTEND for Hostinger static hosting (momome.xyz).
# Produces app/dist/ — upload its CONTENTS to public_html — and a zip you can
# extract in Hostinger's File Manager.
#
#   VITE_API_BASE  the backend the SPA calls (default the api.momome.xyz host)
#   SITE_URL       canonical/SEO domain (default https://momome.xyz)
#
# e.g.  VITE_API_BASE=https://momome-api-production.up.railway.app/api bash scripts/build-hostinger.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

API_BASE="${VITE_API_BASE:-https://api.momome.xyz/api}"
SITE="${SITE_URL:-https://momome.xyz}"

echo "──────────────────────────────────────────────"
echo " Building MoMo›Me frontend for Hostinger"
echo "   VITE_API_BASE = $API_BASE"
echo "   SITE_URL      = $SITE"
echo "──────────────────────────────────────────────"

VITE_API_BASE="$API_BASE" SITE_URL="$SITE" pnpm --filter @momome/app build

DIST="app/dist"
# Vite copies app/public/.htaccess → dist/.htaccess; ensure it's there.
[ -f "$DIST/.htaccess" ] || cp app/public/.htaccess "$DIST/.htaccess"

rm -f momome-hostinger.zip
( cd "$DIST" && zip -r -q ../../momome-hostinger.zip . )

echo
echo "✅ Built $DIST/ (with .htaccess) and momome-hostinger.zip"
echo "   Upload the CONTENTS of $DIST/ to Hostinger public_html,"
echo "   or upload momome-hostinger.zip and Extract it there."

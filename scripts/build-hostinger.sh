#!/usr/bin/env bash
# ============================================================
# Build the MoMo›Me FRONTEND for Hostinger static hosting (momome.xyz).
# Produces app/dist/ — upload its CONTENTS to public_html — and a zip you can
# extract in Hostinger's File Manager.
#
#   VITE_API_BASE  the backend the SPA calls (default: the live Vercel backend)
#   SITE_URL       canonical/SEO domain (default https://momome.xyz)
#
# Override VITE_API_BASE only if you front the backend with a custom domain
# (e.g. api.momome.xyz) — that host must actually resolve, or the SPA can't
# reach the API. The default below is the real, reachable backend.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# Default to the actual deployed backend (Vercel — Railway is torn down). A no-arg
# build must point at a host that actually resolves, or the SPA can't reach the API.
# Keep this in sync with connect-src in app/public/.htaccess.
API_BASE="${VITE_API_BASE:-https://mo-mo-me-server.vercel.app/api}"
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

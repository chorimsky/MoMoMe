#!/usr/bin/env bash
# ============================================================
# Build the MoMo›Me FRONTEND for Hostinger static hosting (momome.xyz).
# Produces app/dist/ — upload its CONTENTS to public_html — and a zip you can
# extract in Hostinger's File Manager.
#
#   VITE_API_BASE  the backend the SPA calls (default: the live Railway backend)
#   SITE_URL       canonical/SEO domain (default https://momome.xyz)
#
# Override VITE_API_BASE only if you front the backend with a custom domain
# (e.g. api.momome.xyz) — that host must actually resolve, or the SPA can't
# reach the API. The default below is the real, reachable backend.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# Default to the actual deployed backend. (The old default api.momome.xyz is
# NXDOMAIN — a no-arg build with it shipped a frontend that couldn't reach the API.)
API_BASE="${VITE_API_BASE:-https://momome-api-production.up.railway.app/api}"
SITE="${SITE_URL:-https://momome.xyz}"

echo "──────────────────────────────────────────────"
echo " Building MoMo›Me frontend for Hostinger"
echo "   VITE_API_BASE = $API_BASE"
echo "   SITE_URL      = $SITE"
echo "──────────────────────────────────────────────"

# Self-host the Wavelength wallet wasm runtime (+ worker) under app/public/ so vite
# build copies it into dist/. It's gitignored (~145MB), so fetch it here; idempotent.
bash scripts/fetch-wavelength-runtime.sh

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

#!/usr/bin/env bash
# Builds both partnership decks from deck.html.
# deck.html is the single source; data-variant on <html> selects the cut.
#   .tech-only  — source file names, vendor statuses (technical call only)
#   .biz-only   — the business-safe replacement for each of those
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cp deck.html "$TMP/technical.html"
# Only the <html> tag, never the CSS selectors further down the file.
sed 's|<html lang="en" data-variant="technical"|<html lang="en" data-variant="business"|' \
  deck.html > "$TMP/business.html"

for v in technical business; do
  out="WUL-MoMoMe-x-Sorted-$(tr '[:lower:]' '[:upper:]' <<< "${v:0:1}")${v:1}.pdf"
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$PWD/$out" --virtual-time-budget=12000 \
    "file://$TMP/$v.html" 2>/dev/null
  echo "built $out"
done

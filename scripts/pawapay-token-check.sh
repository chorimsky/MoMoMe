#!/usr/bin/env bash
# ============================================================
# PawaPay token diagnostic — READ-ONLY. Moves NO money.
#
# Tells you, for whatever token you give it:
#   • its length + last 6 chars (so you can confirm WHICH token it is, e.g. …p1SQ)
#   • its decoded claims (merchant `sub`, permissions `pm`, expiry)
#   • whether it AUTHENTICATES on the PRODUCTION API (api.pawapay.io)
#
# No placeholders to forget. Put the token ALONE in a file, then run this:
#   nano /tmp/pp_token.txt          # paste ONLY the token, save (Ctrl+O, Enter, Ctrl+X)
#   bash scripts/pawapay-token-check.sh
#
# Or:  bash scripts/pawapay-token-check.sh /path/to/tokenfile
# Or:  bash scripts/pawapay-token-check.sh --clip      # read from the clipboard
# ============================================================
set -euo pipefail
BASE="${PAWAPAY_API_URL:-https://api.pawapay.io}"

if [ "${1:-}" = "--clip" ]; then RAW="$(pbpaste)"; SRC="clipboard"
elif [ -n "${1:-}" ] && [ -f "$1" ]; then RAW="$(cat "$1")"; SRC="$1"
elif [ -f /tmp/pp_token.txt ]; then RAW="$(cat /tmp/pp_token.txt)"; SRC="/tmp/pp_token.txt"
else
  echo "No token found. Paste it into a file first:"
  echo "   nano /tmp/pp_token.txt     (paste ONLY the token, save)"
  echo "then re-run:  bash scripts/pawapay-token-check.sh"
  exit 1
fi

# Hidden-character detection (PawaPay's theory). A JWT is pure ASCII [A-Za-z0-9_.-].
# Keep ONLY those bytes — this removes whitespace AND non-whitespace invisibles a copy
# can pick up (BOM U+FEFF, zero-width U+200B–200D, non-breaking space U+00A0, CR/LF).
RAW_BYTES=$(printf '%s' "$RAW" | LC_ALL=C wc -c | tr -d ' ')
TOK="$(printf '%s' "$RAW" | LC_ALL=C tr -cd 'A-Za-z0-9_.-')"
[ -n "$TOK" ] || { echo "Token source ($SRC) is EMPTY — nothing to check."; exit 1; }
STRAY=$(( RAW_BYTES - ${#TOK} ))

echo "─────────────────────────────────────────────"
echo " source : $SRC"
echo " length : ${#TOK} chars  (raw $RAW_BYTES bytes → $STRAY stray/hidden byte(s) removed)"
if [ "$STRAY" -gt 0 ]; then
  echo "   ⚠ the raw copy contained $STRAY non-JWT byte(s) (whitespace or hidden chars);"
  echo "     we test the CLEANED token below — if THAT still fails, hidden chars are NOT the cause."
fi
echo " ends   : …${TOK: -6}"
echo " dots   : $(printf '%s' "$TOK" | awk -F. '{print NF-1}')   (a JWT has exactly 2)"
printf '%s' "$TOK" | cut -d. -f2 | python3 -c '
import sys,base64,json,datetime
s=sys.stdin.read().strip(); s+="="*(-len(s)%4)
try:
    d=json.loads(base64.urlsafe_b64decode(s))
    if "exp" in d: d["exp_utc"]=str(datetime.datetime.fromtimestamp(d["exp"],datetime.timezone.utc))
    print(" claims :", json.dumps(d))
except Exception:
    print(" claims : (could not decode — this may not be a JWT / may be garbled)")
' 2>/dev/null || echo " claims : (decode failed)"
echo "─────────────────────────────────────────────"
echo " read-only auth check → $BASE/v2/active-conf"
HTTP=$(curl -s --max-time 12 -o /tmp/pp_check.json -w "%{http_code}" "$BASE/v2/active-conf" -H "authorization: Bearer $TOK" || echo "000")
if grep -q "UMDENY" /tmp/pp_check.json 2>/dev/null; then
  echo " ✅ HTTP $HTTP — token AUTHENTICATES (account found)."
  echo "    → This token is good. Test a payout with it (REAL money):"
  echo "      PAWAPAY_TOKEN=\"\$(cat ${SRC/clipboard//tmp/pp_token.txt} | tr -d '[:space:]')\" bash scripts/pawapay-payout-test.sh 237680344485 MTN 100"
else
  echo " ❌ HTTP $HTTP — $(head -c 200 /tmp/pp_check.json)"
  echo "    → This token is NOT accepted by the production API."
fi
echo "─────────────────────────────────────────────"

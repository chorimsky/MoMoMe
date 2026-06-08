#!/usr/bin/env bash
# ============================================================
# PawaPay LIVE payout smoke test — confirms the PAYOUTS_NOT_ALLOWED gate is
# lifted by submitting ONE real v2 payout and polling it to a terminal status.
#
#   ⚠️  THIS MOVES REAL MONEY (production account UMDENY SARL, XAF wallet).
#       Use the smallest amount and a phone number YOU control.
#
# Usage:
#   bash scripts/pawapay-payout-test.sh <MSISDN> <MTN|ORANGE> [amountXAF]
#   e.g. bash scripts/pawapay-payout-test.sh 2376XXXXXXXX MTN 100
#
# Token: pulled from Railway if you're logged in (railway login) or
#   RAILWAY_API_TOKEN is exported. Or paste it directly:  PAWAPAY_TOKEN=... bash ...
# ============================================================
set -euo pipefail

PHONE="${1:?Usage: bash scripts/pawapay-payout-test.sh <MSISDN e.g. 2376XXXXXXXX> <MTN|ORANGE> [amountXAF]}"
PROV_IN="${2:-MTN}"
AMOUNT="${3:-100}"

case "$PROV_IN" in
  MTN|mtn)       PROVIDER=MTN_MOMO_CMR ;;
  ORANGE|orange) PROVIDER=ORANGE_CMR ;;
  *) echo "provider must be MTN or ORANGE"; exit 1 ;;
esac

# MSISDN: digits only, ensure 237 country prefix.
PHONE_DIGITS=$(printf '%s' "$PHONE" | tr -cd '0-9')
case "$PHONE_DIGITS" in 237*) ;; *) PHONE_DIGITS="237$PHONE_DIGITS" ;; esac

# Production base (the prod token only authenticates here).
BASE="${PAWAPAY_API_URL:-https://api.pawapay.io}"

# Resolve the API token.
TOK="${PAWAPAY_TOKEN:-}"
if [ -z "$TOK" ]; then
  TOK=$(railway variables --service momome-api --kv 2>/dev/null | grep '^PAWAPAY_API_KEY=' | cut -d= -f2- || true)
fi
[ -n "$TOK" ] || { echo "No token. Export PAWAPAY_TOKEN=... or RAILWAY_API_TOKEN=... (or run 'railway login')."; exit 1; }

# Valid v4 UUID payoutId (PawaPay validates the format; unique per run).
PID=$(python3 -c "import uuid;print(uuid.uuid4())")

echo "──────────────────────────────────────────────"
echo " PawaPay LIVE payout test"
echo "  amount   : $AMOUNT XAF   (REAL MONEY)"
echo "  to       : $PHONE_DIGITS"
echo "  provider : $PROVIDER"
echo "  payoutId : $PID"
echo "──────────────────────────────────────────────"
read -r -p "Type 'yes' to submit this REAL payout: " ok
[ "$ok" = "yes" ] || { echo "aborted."; exit 0; }

echo "=== POST /v2/payouts ==="
curl -s -X POST "$BASE/v2/payouts" \
  -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d "{\"payoutId\":\"$PID\",\"recipient\":{\"type\":\"MMO\",\"accountDetails\":{\"phoneNumber\":\"$PHONE_DIGITS\",\"provider\":\"$PROVIDER\"}},\"amount\":\"$AMOUNT\",\"currency\":\"XAF\",\"customerMessage\":\"MoMoMe test\"}" \
  | python3 -m json.tool || true

echo "=== poll GET /v2/payouts/$PID ==="
for i in 1 2 3 4 5 6 7 8; do
  sleep 4
  echo "--- poll $i ---"
  curl -s "$BASE/v2/payouts/$PID" -H "authorization: Bearer $TOK" | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('data',d), indent=1))" || true
done
echo
echo "Expected: submit → status ACCEPTED, then poll → data.status COMPLETED."
echo "If you instead see PAYOUTS_NOT_ALLOWED, the gate is NOT lifted — send PawaPay this exact request + response."

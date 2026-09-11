# MoMo›Me's own Lightning node — ACINQ phoenixd, self-custodial, auto-liquidity.
#
# Runs as its own Railway service next to momome-api. The seed and channel state live in
# /phoenix on a Railway VOLUME (mount it at /phoenix — losing it loses the funds).
# The HTTP API is reached over Railway's private network as http://phoenixd.railway.internal:9740
# and is never exposed publicly.
FROM acinq/phoenixd:latest

# Everything phoenixd needs is passed on the command line (it also honours ~/.phoenix/phoenix.conf).
#   PHOENIXD_HTTP_PASSWORD  — the API password momome-api uses (set the same value as
#                             PHOENIXD_PASSWORD on momome-api). Pick a long random string.
#   PHOENIXD_WEBHOOK_URL    — https://<momome-api public host>/webhooks/phoenixd
#   PHOENIXD_WEBHOOK_SECRET — HMAC key for X-Phoenix-Signature (same value as
#                             PHOENIXD_WEBHOOK_SECRET on momome-api)
#   PHOENIXD_CHAIN          — mainnet (default) or testnet
EXPOSE 9740
ENTRYPOINT ["/bin/sh", "-c", "exec phoenixd \
  --agree-to-terms-of-service \
  --chain ${PHOENIXD_CHAIN:-mainnet} \
  --http-bind-ip 0.0.0.0 --http-bind-port 9740 \
  --http-password \"$PHOENIXD_HTTP_PASSWORD\" \
  --webhook \"$PHOENIXD_WEBHOOK_URL\" \
  --webhook-secret \"$PHOENIXD_WEBHOOK_SECRET\" \
  --auto-liquidity 2m"]

# Security model (UPI layer)

- **No public directory.** Every resolving call is POST, authenticated (signed device / partner key / admin), purpose-bound, rate-limited per actor and per IP, and under the identity enumeration rule (`IDENTITY_MAX_DISTINCT_PER_HOUR`, `_IP`). The Lightning Address endpoint masks names unless the holder proved the number (Settings policy).
- **Names are never fabricated**: only the identity chain (Peexit `verify_wallet`, MTN direct when configured) may set a holder; foreign identities carry no name.
- **Keys:** none for stablecoins in this codebase (see STABLECOIN_CUSTODY_MODEL.md); rail credentials live in Railway variables; `.env` files are gitignored.
- **Idempotency** is inherited from V1 (one quote claim, one payout key) and the network saga; the chain lifecycle never re-broadcasts.
- **Compliance hooks**: every intent passes through the V1 gates (velocity, sanctions list, limits, near-miss, name mismatch, identity gate) when executed; the intent record carries the correlation id for AML review. Travel Rule fields are left to UMA.
- **Flags** are independent and off; `ROUTING_ENGINE_MODE=SHADOW` by default; corridor flags per pair.

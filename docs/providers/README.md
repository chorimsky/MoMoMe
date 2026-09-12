# Providers

| Provider | Rail(s) | Role | Config | Verified quirks |
|---|---|---|---|---|
| IBEX Hub | lightning, onchain_btc, stablecoin | licensed crypto rail: mints invoices/addresses, holds and converts | `IBEX_*` | BTC in msat; stablecoin amounts in whole tokens; deposits reported by account + tx hash, no address; list paginates by `page`, filters ignored; cannot set LUD-06 `description_hash` |
| phoenixd (own node) | lightning | optional: description-hash invoices, failover, refunds | `PHOENIXD_*` | buys liquidity from the first receive; fees booked as `rail_fees` |
| Peexit | mobile_money | live payout aggregator (Orange, MTN) | `PEEXIT_*` | authenticates on source IP; fresh tx 404 for ~3 days → settle by re-query |
| PawaPay | mobile_money | payout aggregator (MTN) | `PAWAPAY_*` | callbacks unverified (RFC-9421) → settle by polling |
| Sandbox | all | simulator, never on a live-money deployment | — | — |
| Meta WhatsApp / Model API | channels | not a payment rail | `WHATSAPP_*`, `META_AI_*` | see docs/whatsapp.md |

`GET /api/v1/providers` reports each with `health` (OPERATIONAL / DEGRADED / DOWN /
NOT_CONFIGURED / SANDBOX), success rate, latency and, for payout rails, available liquidity.

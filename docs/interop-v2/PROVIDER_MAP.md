# Provider map

| Market | Provider | Collect | Payout | Adapter | Status |
|---|---|---|---|---|---|
| CM | MTN MoMo | Peexit collect | Peexit (primary), PawaPay | `cm:peexit`, `cm:pawapay` (wrap production adapters) | live |
| CM | Orange Money | Peexit collect | Peexit | `cm:peexit` | live |
| GA, CG, TD, CF | Airtel / Moov / MTN / Orange | — | — | `sim:*` (sandbox only) | configured, not enabled |
| KE | M-Pesa, Airtel | — | — | `sim:ke` | needs a rail (Safaricom Daraja B2C / an aggregator) |
| GH | MTN MoMo, Telecel, AT | — | — | `sim:gh` | needs a rail |
| NG | MoMo PSB, Airtel SmartCash, OPay | — | — | `sim:ng` | needs a rail |
| SN, CI | Wave, Orange, MTN | — | — | `sim:*` | needs a rail (BCEAO zone, XOF) |

Interface: `MobileMoneyProviderAdapter` — verifyRecipient, createCollection, getCollectionStatus,
createPayout, getPayoutStatus, getBalance, getLimits, getSupportedCurrencies,
getProviderHealth, payoutFeePct. Aggregators implement the same interface (`aggregator`
field). A market is activated by (1) an adapter that is `configured()`, (2) `MARKETS[code]
.enabled = true` and the provider's `collect`/`payout` set true (or a settings override), (3)
liquidity, (4) an FX feed for its currency, (5) the corridor switch.

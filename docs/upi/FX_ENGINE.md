# FX engine

`core/upi/fx.ts fxRate(from, to)` → `{ pair, rate, mid, spreadBps, source, timestamp, expiresAt }` (30 s). Crypto/stablecoin ↔ XAF from `core/rates` (Coinbase + Kraken, divergence-refused, EUR/XAF peg) with the admin spread per method; fiat ↔ fiat from the network's public USD table (two venues, 2 % divergence refusal); stablecoin ↔ other fiat composed through USD. `null` when no fresh feed can price it — a quote option then reads "no fresh rate" and is unavailable. Nothing is hard-coded.

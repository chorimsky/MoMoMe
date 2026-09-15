# Interop v2 — the Pan-African Mobile Money → Lightning → Mobile Money network

**Principle.** MoMo›Me does not move Mobile Money from one operator to another. It converts
the value of the originating Mobile Money into a Lightning settlement position, transports
that value over Lightning, converts it back into local liquidity, and pays the destination
Mobile Money. Every market is a liquidity node; every provider is a local rail connected once.

**Production rule.** The live Cameroon engine (`/api/quotes`, `/api/payments`, the XAF ledger,
Peexit/PawaPay, IBEX) is treated as immutable. The network is built beside it, behind flags
that are all OFF, proven in shadow mode and in the sandbox, and moved into only progressively.

| Phase | State | Where |
|---|---|---|
| 0 Audit | done | this folder — CURRENT_ARCHITECTURE, PRODUCTION_CRITICAL_PATH, PAYMENT_FLOW, FINANCIAL_DATA_MODEL, PROVIDER_MAP, LIGHTNING_MAP, RISK_REGISTER |
| 1 Lock down v1 | in force | 79 server test files (`pnpm --filter ./server test`) run before every deploy; `network.test.ts` asserts the v1 quote engine is untouched with the network on |
| 2 Domain abstractions | done | `shared/network.ts` — Market, Corridor, LiquiditySource/Position/Reservation, NetworkIntent, NetworkQuote, NetworkRoute, NetworkTransaction (saga), FxQuote, FeeBreakdown, network ledger |
| 3 Router in shadow | done | `core/network/router.ts` + `shadow.ts`; `SHADOW_ROUTING` flag; Admin → Interoperability → Shadow routing |
| 4 Liquidity engine | done | `core/network/liquidity.ts` — sources, positions (AVAILABLE/RESERVED/COMMITTED/…), reserve/commit/release, floors + alerts |
| 5 Lightning settlement abstraction | done | `core/network/settlement.ts` — partner Lightning Address (via production IBEX adapter), network pool position, simulated; open standards only |
| 6 First corridor | **ready to rehearse with a PawaPay key** | Activation is configuration: `settings.network.markets` switches a market / provider role on (Admin → Interoperability → Markets & providers); `core/network/pawapayMarkets.ts` is the multi-market payout+collection rail (MPESA_KEN, MTN_MOMO_GHA … over PawaPay v2, own idempotency map, never touches the CM adapter); `core/network/fx.ts` pulls a public USD table (Coinbase, open.er-api fallback) so KES/GHS/NGN are priced on a feed; the per-corridor **activation checklist** (`core/network/activation.ts`, `GET /api/admin/network/corridors/:id/checklist`) lists every must-have — a simulated rail can never make a corridor READY. Still needed: a PawaPay contract for the market, KE float, legal review (RISK_REGISTER #7) |
| 7 Canary | controls built | `settings.network.canary` — device allowlist, rollout share (stable hash bucket), per-corridor `maxPerTx` / rolling-24 h `maxPerDay` in source currency — enforced in `saga.executionGate` (`canary_refused`, 403); `/api/network` now authenticates devices with the same signed-device gate as `/api` (RISK #9 closed); `corridors` switch + `disabled.*` emergency controls |
| 6b Time-driven saga | done | `core/network/monitor.ts` `networkTick()` (every 30 s from jobs, `POST /api/admin/network/tick` on demand): polls real rails for COLLECTION_PENDING / PAYOUT_INITIATED, expires collections after `settings.network.collectionTimeoutMin` (a collection that lands after expiry is booked and refunded, never lost), and with `settings.network.autoRefund` pays the payer back on the source rail (`${id}:refund`, idempotent) and closes the liability; PawaPay callbacks for network ids call `hint()` — the poll is the authority |
| 6c Customer surface | done (web) | `/send-abroad` (`app/src/pages/SendAbroad.tsx`): country → their network/number → amount → quote (what they receive, rate, every fee, countdown) → confirm → the lifecycle in money words. Entry points (landing CTA, a tile on the Send method step) appear only while `/config.network.enabled` — i.e. a corridor out of CM is switched on and `INTEROPERABILITY_V2` is on. `GET /api/network/markets` lists destinations with the corridor's canary-capped amount bounds. Mobile: not yet |
| 8 Expansion | configuration | `core/network/markets.ts` rows + adapters |

**Surface.** `POST /api/network/intents` → routes/quotes · `POST /api/network/intents/:id/confirm` →
reserve + collect · `GET /api/network/transactions/:id` · sandbox: `POST /api/network/sim/:txId/{collection,payout}`
· admin: `GET /api/admin/network`, `PUT /api/admin/network/settings`, `POST /api/admin/network/shadow/run`,
`POST /api/admin/network/tx/:id/{recover,refunded}`, `GET /api/admin/network/corridors/:id/checklist`,
`POST /api/admin/network/fx/refresh`. Customer calls are device-authenticated exactly like `/api/*`
(partner API key, or an enrolled device's per-request signature over the path relative to `/api`,
e.g. `/network/intents`). The whole `/api/network` surface answers 404
unless `INTEROPERABILITY_V2` is on (always reachable in the sandbox).

**Flags** (`settings.network.flags`, all default false): SHADOW_ROUTING, INTEROPERABILITY_V2,
ROUTING_ENGINE, LIQUIDITY_ENGINE, LIGHTNING_SETTLEMENT_V2, CROSS_BORDER_PAYMENTS,
MULTI_PROVIDER_ROUTING; per-corridor `corridors["CM-KE"]`; emergency `disabled.{markets,
providers, aggregators, pools, lightningRoutes, partners}`.

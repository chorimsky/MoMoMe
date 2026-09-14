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
| 6 First corridor | **needs partners** | CM→KE rehearsed end to end on simulated rails (`test/network.test.ts`); a real corridor needs a KE payout rail, KE liquidity and a KES feed — see RISK_REGISTER |
| 7 Canary | not started | `corridors` switch per corridor; `disabled.*` emergency controls |
| 8 Expansion | configuration | `core/network/markets.ts` rows + adapters |

**Surface.** `POST /api/network/intents` → routes/quotes · `POST /api/network/intents/:id/confirm` →
reserve + collect · `GET /api/network/transactions/:id` · sandbox: `POST /api/network/sim/:txId/{collection,payout}`
· admin: `GET /api/admin/network`, `PUT /api/admin/network/settings`, `POST /api/admin/network/shadow/run`,
`POST /api/admin/network/tx/:id/{recover,refunded}`. The whole `/api/network` surface answers 404
unless `INTEROPERABILITY_V2` is on (always reachable in the sandbox).

**Flags** (`settings.network.flags`, all default false): SHADOW_ROUTING, INTEROPERABILITY_V2,
ROUTING_ENGINE, LIQUIDITY_ENGINE, LIGHTNING_SETTLEMENT_V2, CROSS_BORDER_PAYMENTS,
MULTI_PROVIDER_ROUTING; per-corridor `corridors["CM-KE"]`; emergency `disabled.{markets,
providers, aggregators, pools, lightningRoutes, partners}`.

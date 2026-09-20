# Multi-rail routing

`core/upi/routing.ts`. Every route is described the same way: type (DIRECT · LIGHTNING · STABLECOIN · AGGREGATOR · HYBRID), source/settlement/destination rail, steps, fee lines, FX, latency, liquidity (pool, available, required, ok), provider availability, risk, limits, status + reason.

**No score.** Ordering is a configured rule: `ROUTING_RULE=cost,latency,priority` (default) over `ROUTING_RAIL_PRIORITY=LIGHTNING,STABLECOIN,MOBILE_MONEY,AGGREGATOR,HYBRID`. Unavailable rails are excluded, never down-ranked; a route whose pool cannot fund it is `LIQUIDITY_UNAVAILABLE`.

Domestic (CM→CM): one route per quote option (Lightning, USDT/ETHEREUM, USDC/ETHEREUM, Mobile Money→Mobile Money when `features.momoTransfer`). Cross-border: the network layer's `discover()` supplies routes/quotes and executes through its saga; the UPI layer requires `CROSS_BORDER_ROUTING_ENABLED` **and** `CORRIDOR_<SRC>_<DST>_ENABLED` **and** the network's own corridor switch.

**Shadow mode** (`ROUTING_ENGINE_MODE=SHADOW`, default). Two sources of comparisons: intents created through `/api/v2` and — the one that matters — **every real V1 payment** (`core/upi/shadow.ts shadowFromV1`, called fire-and-forget from `createPaymentCore` while `UNIVERSAL_PAYMENT_IDENTITY_ENABLED`): the payment becomes a linked shadow intent, resolved from the identity cache, quoted, routed with the sender's chosen method as the V1 reference, and mirrored to completion. Nothing is executed twice; a shadow failure cannot touch the payment. `recordShadow` stores engine route vs V1's (the payer's pick; V1 default Lightning), fees, FX, latency, liquidity; `shadowSummary()` in Admin (`/api/admin/upi`). Execution is refused with a plain message. Switch to EXECUTE only after the agreement rate is understood.

No N×N: every provider connects once through its adapter; routing composes.

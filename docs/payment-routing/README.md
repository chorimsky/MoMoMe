# Payment routing

`core/interop/router.ts`. Deterministic, ordered, explainable. No model in the loop.

For an intent and its resolved destination, one candidate route per pay-in method
(Lightning, USDT, USDC, on-chain BTC — or only the sender's preferred method). Each route
records these checks, in this order:

1. `destination_supported` — address ACTIVE and an operator identified
2. `within_limits` — amount inside the destination's limits
3. `accepting_payments` — operator kill-switch
4. `payout_rail_operational` — an eligible payout aggregator for the operator
5. `liquidity` — a FUNDED payout rail for this amount and enough XAF float
6. `source_rail_available` — method on offer and a real rail serves it
7. `source_rail_operational` — that rail is eligible right now
8. `compliance` — clear, or "will hold for operator approval" above the threshold
9. `quote` — the quote engine accepted (rates fresh, amount valid)

A route is **viable** when every check passes. Viable routes are ranked by a composite
score: cost 50 % (fee as a share of amount), speed 30 %, reliability 20 % (recent success
rate of the source rail). The highest is `recommended`. Non-viable routes are returned too,
with the failing check named, so a client can explain why a method is not offered.

Route selection and route execution are separate calls: `POST …/routes` decides, `POST
…/execute` locks a route (quote still valid), creates the engine payment through the same
`createPaymentCore` the app uses, and links intent ↔ route ↔ payment. The intent is the
lock: executing twice returns the same payment.

Multi-step routes are modelled (`steps[]` with source / conversion / destination and the
party for each). Today every route is three steps: crypto rail → MoMo›Me → payout rail.

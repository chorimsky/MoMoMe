# PaymentIntent v2

`core/upi/intents.ts`. An intent is *what* is being paid to *whom*; source and destination are open until routing.

## Lifecycle
```
CREATED → IDENTITY_RESOLVED → QUOTED → ROUTE_SELECTED → LIQUIDITY_RESERVED → PAYMENT_PENDING
        → PAYMENT_DETECTED → PAYMENT_CONFIRMED → SETTLEMENT_PENDING → SETTLEMENT_PROCESSING
        → SETTLEMENT_COMPLETED → COMPLETED
failures: EXPIRED · CANCELLED · PAYMENT_FAILED · SETTLEMENT_FAILED · LIQUIDITY_FAILED · PROVIDER_UNAVAILABLE · RECONCILIATION_REQUIRED
```
Every transition is an event with a note. Nothing external is assumed atomic: the money leg belongs to the V1 state machine (domestic) or the network saga (cross-border); `syncIntent()` maps their states (`V1_TO_V2`, network map) on each read, so the intent can never claim more than the engine that holds the money.

## Steps
1. `createIntent` — resolve identity (purpose `PAYMENT_CREATION`); gate mode refuses NOT_FOUND / INACTIVE (CANCELLED, Test 10); amount is in the recipient's currency unless stated; quote every option.
2. `selectRouteFor` — deterministic route under the configured rule; shadow record written (`engineRoute` vs `v1Route`, agree?); LIQUIDITY_FAILED when a route exists but cannot be funded (Test 7); PROVIDER_UNAVAILABLE when rails are down (Test 9).
3. `executeIntent` — only with `PAYMENT_INTENT_V2_ENABLED` and `ROUTING_ENGINE_MODE=EXECUTE`; domestic only today; stablecoin funding additionally needs the stablecoin flags; mints the V1 quote + payment under the registered name; the `PaymentRequestV2` carries the V1 pay instruction and every reference.
4. Reads re-sync; `cancelIntent` before execution only.

## PaymentRequest as the universal abstraction
`PaymentRequestV2 { protocol: BOLT11 | LNURL_PAY | ERC20_TRANSFER | MOBILE_MONEY_COLLECTION | BANK_TRANSFER | UMA, instruction, expiresAt, refs }` — the invoice is one representation. Negotiation (payer has USDT, recipient wants XAF) is what the quote options already express.

## References carried
`correlationId, paymentIntentId, quoteId, routeId, settlementId, v1PaymentId | networkTxId, providerReference, blockchainTxid, mobileMoneyReference` (`LedgerRefs`, filled by `refsOf`).

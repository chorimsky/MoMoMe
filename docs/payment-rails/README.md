# Payment rails

A **rail** is a network class; a **provider** is one operator/integration on it.

| Rail id | Direction today | Currency | Providers today | Regulated party |
|---|---|---|---|---|
| `mobile_money` | send (payout) | XAF | Peexit, PawaPay → MTN, Orange | the aggregator + operator |
| `lightning` | receive, send (refunds) | BTC | IBEX Hub; own node (phoenixd, optional) | IBEX / MoMo›Me node |
| `onchain_btc` | receive | BTC | IBEX Hub | IBEX |
| `stablecoin` | receive | USDT, USDC (ERC-20) | IBEX Hub | IBEX |
| `bank`, `card`, `ussd` | — | — | not connected | — |

`GET /api/v1/rails` returns this live: capabilities, providers with health and liquidity,
limits, fees and the regulated party. Nothing is fabricated: a rail with no configured
provider shows `NOT_CONFIGURED`.

## The adapter contracts (what already exists)

Crypto inbound — `server/src/adapters/types.ts` `RailAdapter`:
`name, priority, configured(), trusted(), supports(method), createInstruction(),
verifyWebhook(), parseEvent(), confirmSettlement?(), listDeposits?(), payInvoice?(),
outboundStatus?(), descriptionHash?`

Mobile-Money payout — `server/src/adapters/payouts.ts` `PayoutAdapter`:
`name, priority, configured(), live(), supports(operator), disburse(), queryStatus(),
balance(), statusByKey(), verifyCallback?(), parseCallback?()`

These map onto the conceptual `PaymentRailAdapter` (identify / capabilities / quote /
validate / createPayment / executePayment / getStatus / cancel / refund / verify) as
follows: identify = `name`; capabilities = registry row (`core/interop/rails.ts`); quote =
`buildQuote` over `core/fx.ts`; validate = `supports` + `checkPhone`; createPayment =
`createInstruction` / `disburse`; getStatus = `confirmSettlement` / `queryStatus`; refund =
`payInvoice`; verify = `verifyWebhook` / `verifyCallback`.

## Adding a rail — the eight steps

1. **Adapter**: implement `RailAdapter` (inbound) or `PayoutAdapter` (outbound) in
   `server/src/adapters/<name>.ts`. Provider syntax stays inside the file.
2. **Register**: add it to `RAILS` (`adapters/index.ts`) or `PAYOUTS` (`adapters/payouts.ts`).
3. **Capabilities**: add its `describe` row in `core/interop/rails.ts` (rail id,
   currencies, directions, regulated party).
4. **Compliance rules**: limits per operator in `shared/domain.ts` (`PROVIDER_PAYOUT_MAX`),
   approval threshold in Settings.
5. **Limits**: `COUNTRIES` entry if a new country; `MIN_XAF`/`MAX_XAF` or per-rail limits.
6. **Routing**: nothing — the router enumerates registered rails. Add a scoring input in
   `router.ts` `score()` only if the rail needs one.
7. **Test**: an e2e in `server/test/` with the provider's HTTP surface faked (see
   `usdc-e2e.test.ts`, `phoenixd-lnurl.test.ts`).
8. **Activate**: set its environment variables; `configured()` turns it on. No release of
   the payment core.

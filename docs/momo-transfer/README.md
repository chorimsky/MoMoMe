# Mobile Money → Mobile Money (MTN ↔ Orange, and beyond)

**Status: built, admin-gated, OFF by default.** `Settings → Product features → Mobile Money →
Mobile Money transfers`. While off, users never see it and every endpoint under
`/api/momo/transfers` answers 403 `feature_disabled` — except to the admin console, which can
create test transfers.

## The problem

MTN Mobile Money and Orange Money are silos. Moving 10 000 XAF from one to the other today
means cashing out at an agent, walking, and cashing in: two fees, a queue, and a risk. Every
network is its own island; a person on MTN cannot pay a person on Orange.

## How MoMo›Me connects them

```
 payer (MTN)  ──collection prompt──▶  aggregator collection wallet  ──▶  payout float  ──▶  recipient (Orange)
              approves with PIN              (XAF, ours)                   (XAF, ours)        paid in seconds
```

1. The payer types their own number and the recipient's. The server first checks that the
   recipient's network **can be paid right now** (a funded payout rail); otherwise it refuses
   before anything is asked of the payer.
2. A **collection request** goes to the payer's phone through the aggregator (Peexit serves
   both MTN and Orange). The payer approves with their PIN. Until then nothing has moved and
   the request can be cancelled; it lapses after 15 minutes.
3. Once the aggregator confirms the collection, the money is booked (`momo_collect_clearing`
   → `customer_wallet`, fee → `fee_revenue`) and the recipient is paid from the payout float
   on their own network. Delivery is confirmed by re-querying the rail, never from a callback
   alone. Both parties are notified.
4. If the payout fails after collection, the **full amount including the fee is returned** to
   the payer's number (`REFUNDED`). If even the refund cannot be made automatically, the
   operator is alerted to do it by hand; the money is never silently kept.

The compliance engine screens every transfer before the collection (watchlist, velocity,
CDD). A flagged transfer collects, then holds (`REFUND_PENDING` with flags) for an operator
to **Release** or refund from Admin → Mobile Money → Transfers.

## Cost

| leg | who charges | typical |
|---|---|---|
| collection from the payer | aggregator | ~1 % |
| payout to the recipient | aggregator | ~1–2 % |
| MoMo›Me margin | us | 1.5 % (min 100 XAF), paid by the payer |

Against the agent round-trip (two fees, travel, time) this is a fraction of the cost and it
happens in seconds. The float is the working capital: collected XAF settles from the
collection wallet to the payout wallet on the aggregator's schedule (see the Admin Mobile
Money rebalance tool), so the payout float must be funded ahead of demand.

## Where Lightning comes in

Inside the corridors our payout rails reach (Cameroon MTN and Orange today), a Lightning hop
would add a spread and remove nothing: XAF in, XAF out, one operator. So it is not used there.

Lightning is the **interoperability rail between parties that share no aggregator**: another
country, another platform, a wallet. The recipient's **Lightning Address** (`user@domain`) is
the universal endpoint. For such a destination the transfer takes the `lightning` route:

```
 payer (MTN) ──collection──▶ XAF ──our BTC position──▶ pay the Lightning Address ──▶ whoever runs it pays out on its side
```

The sats come from MoMo›Me's own BTC position (IBEX), priced at the current rate, and the
ledger records XAF → `fx_position` → BTC → `external_recipient`. Seen from the other side,
MoMo›Me's own identity `<number>@momome.xyz` is exactly this: any Lightning-capable party in
the world can pay any Cameroonian Mobile Money number. Two MoMo›Me-like operators in two
countries therefore interoperate with no bilateral agreement at all — each collects locally,
pays the other's Lightning Address, and pays out locally, at Lightning's cost.

The route is chosen by `resolveDestination`: a number on a network we pay → `direct`; a
Lightning Address on another domain → `lightning` (refused honestly when no Lightning rail is
configured); a number in a country that is not live → refused with `country_inactive`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/momo/transfers/quote?xaf=` | fee and the amount the payer will be asked for |
| POST | `/api/momo/transfers/resolve` | `{ to, country? }` → `{ route, to }` or the reason it cannot be paid |
| POST | `/api/momo/transfers` | `{ from, to, xaf, country?, fromName?, toName? }` → 201 transfer in `AWAITING_PAYER` |
| GET | `/api/momo/transfers` · `/:id` | the caller's transfers, one transfer |
| POST | `/api/momo/transfers/:id/cancel` | before the payer approves only |
| GET | `/api/admin/momo/transfers` | all transfers (admin) |
| POST | `/api/admin/momo/transfers/:id/release` | pay out a transfer held for review |

States: `AWAITING_PAYER → COLLECTED → PAYING_OUT → DELIVERED`, or `FAILED` / `EXPIRED` /
`CANCELLED` before collection, `REFUND_PENDING → REFUNDED` after it. Every change is an event
on the transfer; every movement is a ledger entry under the transfer's id.

`/api/v1/rails` advertises `mobile_money` directions `["receive", "send"]` only while the
feature is on. Tests: `server/test/momo-transfer.test.ts`.

## What to check before turning it on for users

- Peexit **collection** is enabled on the production account and the callback password is set.
- The payout float on the recipient networks is funded for the expected volume, and the
  collection → payout settlement cadence is understood.
- The CEMAC position on non-bank collection of funds (see `docs/compliance`) is confirmed
  with counsel: collecting from a payer is a different regulatory activity from paying out.

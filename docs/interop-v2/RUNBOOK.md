# Operator runbook — the Pan-African network

Everything below is done from **Admin → Interoperability** unless stated. Nothing here needs a
deploy. Every switch is reversible the same way it was set.

## 1. Before anything moves: shadow first
1. Turn on **SHADOW_ROUTING** only. Production settlements are re-routed in the background
   and compared; no funds move. Leave it for days, not hours.
2. Watch the *Shadow routing* card: comparisons climb, "agreeing" should be ≥ 95 %. Every
   "differs" row names why (rail, amount, or an unavailable route) — fix the cause or accept it
   knowingly before going further.

## 2. Opening a corridor (say CM → KE)
Do these in order; the **Corridor activation checklist** card tracks each one.
1. **Rail**: `PAWAPAY_API_KEY` for the market on the server (operator-owned; never paste it
   anywhere but Railway variables). A sandbox key rehearses against PawaPay's sandbox and
   the checklist says "sandbox" — that is a rehearsal, not activation.
2. **Markets & providers**: tick Kenya, then tick `payout` on M-Pesa. (Cameroon cannot be
   switched off here.)
3. **FX feed**: the KES row must read `public:coinbase+open.er-api` (or one of them). A
   `configured`, `stale` or `divergent` figure blocks activation — press *Refresh*, and if
   the venues disagree by more than 2 %, wait; do not "fix" it in `fxUsd`.
4. **Liquidity**: the destination source (`ke:pawapay`) must show an available balance above
   the floor you set (*Liquidity floors*). The floor is the alarm, not the limit: set it at a
   day's expected volume.
5. **Flags**: INTEROPERABILITY_V2 (exposes the surface), ROUTING_ENGINE, LIQUIDITY_ENGINE,
   CROSS_BORDER_PAYMENTS. LIGHTNING_SETTLEMENT_V2 makes the settlement leg real (IBEX);
   without it the leg is rehearsed and the checklist warns.
6. **Corridor switch**: tick CM-KE.
7. **Canary caps** (*Canary controls*): set a per-transaction cap and a daily cap for CM-KE
   in XAF. Both are must-haves. Start small (e.g. 50 000 / 500 000).
8. **Canary admission**: paste the device ids of the people who will send first into the
   allowlist (Admin → Devices). Rollout stays at 0 %. Nobody else can execute.
9. The checklist reads **READY / Canary**. The "Send abroad" entry points appear in the web
   and the app for everyone, but only admitted devices get past the quote.

## 3. Widening the canary
- Raise **Rollout share** in steps (5 → 25 → 50 → 100 %). A device is in or out by a stable
  hash of its id — it never flaps. 100 % = live for everyone within the caps.
- Raise the caps as the float and the evidence allow. Watch *Monitoring & reconciliation*:
  settled / in flight / failed, average settlement time, the Lightning legs, and
  "stuck"/"unmatched" which must stay at zero.
- Every admitted sender is notified on delivery, refund and manual review through the same
  outbox as the live engine (Admin → Notifications).

## 4. Emergency controls (instant, no deploy)
| To stop… | Do |
|---|---|
| one provider in one market | `disabled.providers` += `KE:MPESA` |
| a whole market | `disabled.markets` += `KE` |
| an aggregator everywhere | `disabled.aggregators` += `pawapay` |
| the Lightning leg | `disabled.lightningRoutes` += `ibex` |
| a partner source | `disabled.partners` += id |
| a corridor | untick it under *Corridors* |
| all new executions | untick ROUTING_ENGINE (in-flight transactions still complete) |
| the whole surface | untick INTEROPERABILITY_V2 (`/api/network` answers 404) |
In-flight transactions are never abandoned by a switch: the monitor keeps polling them.

## 5. When a transaction needs a person
The *Transactions* card names the state and offers the recovery:
| State | Meaning | Action |
|---|---|---|
| COLLECTION_PENDING (long) | payer has not approved | nothing — it expires after `collectionTimeoutMin`; a late approval becomes a refund automatically |
| DESTINATION_SETTLEMENT_FAILED | money collected and settled, payout failed | **retry** (new idempotency key, same rail) → **alternate provider** → **refund**; **manual** parks it |
| LIGHTNING_FAILED → REFUND_PENDING | nothing reached the destination | with *Automatic refunds* on the payer is paid back on their own rail; off, refund by hand and press **refunded** with the provider ref |
| REFUND_PENDING with "refund failed" | the automatic refund was refused | refund by hand, then **refunded** |
| MANUAL_REVIEW | parked by an operator | decide, then retry / refund |
Reconciliation verdicts: *settled* (all three legs confirmed, ledger balanced, reservation
released), *in flight*, *stuck* (> 30 min in one state — poll with *Run monitor*, then look at
the rail), *unmatched* (ledger does not balance — never expected; escalate), *manual*.

## 6. Alarms you will receive (Admin → Notifications, operator audience)
- **Low liquidity** — a source at or under its floor (once per 6 h per source). Top up.
- **Manual review** — a network transaction in a state that needs a decision, with the ref.
- **Transfer failed** — a refund is owed; says whether the automatic refund was submitted.

## 7. Adding a market later
A row in `core/network/markets.ts` (currency, providers, limits, compliance names) and, for
PawaPay, its provider codes in `core/network/pawapayMarkets.ts`; the checklist confirms the
codes against PawaPay's active-conf when the market is switched on. Legal review per market
(RISK_REGISTER #7) is not optional.

# MoMoMe — Backend Design (v1 critical path)

Detailed design for the four load-bearing systems identified in the architecture
review: the **payment lifecycle**, the **ledger + idempotency model**, the **FX
quote/hedging engine**, and the **treasury/float** they all depend on.

Grounded in the frontend's implied contract:
- Inbound rails: Lightning (IBEX), on-chain BTC, USDT (TRON/TRC20) — `components.jsx` `RailBadge`
- Payout: PawaPay → MTN / Orange / Airtel across 5 CEMAC countries — `components.jsx` `COUNTRIES`/`PROVIDERS`
- UX states the backend must drive: `received → confirming → sending → delivered`, plus `Pending/Failed/Completed` — `send.jsx`
- Pricing today (mock): `XAF_PER_USD = 600`, `FEE_PCT = 0.025` — `send.jsx:8-9`

Scope note: XAF is EUR-pegged at **655.957**. Real FX exposure is BTC/EUR (or USDT/EUR) × EUR/USD, not USD directly.

---

## 1. Payment lifecycle state machine

A payment is one durable aggregate. Every transition is persisted with the event
that caused it; the UI is a projection of this state, never the driver.

### States

| State | Meaning | Entry trigger | Timeout |
|---|---|---|---|
| `QUOTED` | Quote issued, awaiting commit | user requests quote | quote TTL (§3) |
| `AWAITING_INBOUND` | Address/invoice issued, watching chain | user commits | invoice/quote expiry |
| `INBOUND_DETECTED` | Tx seen in mempool / HTLC held | rail webhook | rail-specific |
| `INBOUND_CONFIRMED` | Enough confirmations / HTLC settled | rail webhook | — |
| `FX_LOCKED` | XAF amount fixed, hedge placed | engine | — |
| `PAYOUT_REQUESTED` | PawaPay disbursement submitted | engine (idempotent) | PawaPay SLA |
| `PAYOUT_CONFIRMED` | PawaPay callback success | PawaPay webhook | — |
| `DELIVERED` | Terminal success | engine | — |
| `REFUND_PENDING` | Cannot deliver, refund owed | failure handler | — |
| `REFUNDED` | Terminal — funds returned | refund executor | — |
| `FAILED` | Terminal — no funds moved | failure handler | — |
| `MANUAL_REVIEW` | Stuck; human required | any timeout/ambiguity | — |

### Transition rules (the ones that protect money)

```
AWAITING_INBOUND --(underpaid)--> MANUAL_REVIEW        # never auto-pay a short inbound
AWAITING_INBOUND --(overpaid)----> INBOUND_CONFIRMED   # credit actual, refund the excess
AWAITING_INBOUND --(expired,no funds)--> FAILED        # nothing received, clean exit
AWAITING_INBOUND --(late funds after expiry)--> REFUND_PENDING  # arrived too late to honor quote
INBOUND_CONFIRMED --> FX_LOCKED --> PAYOUT_REQUESTED    # only path to a payout
PAYOUT_REQUESTED --(ambiguous/timeout)--> MANUAL_REVIEW # NEVER auto-retry into a 2nd payout
PAYOUT_REQUESTED --(hard reject)--> REFUND_PENDING
```

Three invariants:
1. **`PAYOUT_REQUESTED` is reachable only from `FX_LOCKED`.** No code path pays out
   without a locked rate and a confirmed inbound.
2. **Ambiguous payout never auto-retries.** A timeout or 5xx from PawaPay goes to
   `MANUAL_REVIEW` (or an idempotent *status re-query*, never a fresh submit). This is
   the single most important rule in the system — it's the difference between a hiccup
   and double-paying a recipient.
3. **Every terminal state balances the ledger** (§2). A payment cannot be `DELIVERED`
   without offsetting debit/credit entries summing to zero.

### Per-rail nuance

- **Lightning (IBEX):** invoice carries amount + expiry. HTLC can be *held* until you've
  confirmed payout capacity, then settled — near-atomic. `INBOUND_DETECTED` and
  `INBOUND_CONFIRMED` collapse. Fastest, default for small amounts.
- **On-chain BTC:** unique address per payment (HD-derived). Confirm depth scales with
  amount (e.g. 1 conf < 100k XAF, 2–3 above — the UI already shows "1 of 2 confirmations",
  `send.jsx:101`). 10–60 min window = your worst FX exposure (§3).
- **USDT/TRON:** unique address per payment, ~1 min finality, but watch for chain
  reorgs and frozen-USDT (Tether blocklist) edge cases before crediting.

---

## 2. Ledger + idempotency model

### Double-entry, append-only

Money is never a mutable balance column. It is the sum of immutable journal entries.
Every movement is a balanced transaction (debits == credits).

```
accounts        (id, type, currency, owner_ref)
                 types: customer_wallet, inbound_clearing, fx_position,
                        payout_float_XAF, fee_revenue, hedge_pnl
journal_txns    (id, payment_id, kind, created_at)
journal_entries (id, txn_id, account_id, direction, amount, currency)
                 -- INVARIANT: per txn_id, sum(debits) == sum(credits) per currency
```

Lifecycle of one payment as journal transactions:

| Event | Debit | Credit |
|---|---|---|
| Inbound confirmed | `inbound_clearing` (BTC) | `customer_wallet` (BTC) |
| FX locked | `customer_wallet` (BTC) | `fx_position` (BTC) |
| FX locked | `fx_position` (XAF) | `payout_float_XAF` reserved |
| Fee taken | `customer_wallet` | `fee_revenue` |
| Payout confirmed | `payout_float_XAF` | external (recipient) |
| Refund | reverse the above | — |

Reconciliation = re-deriving each external system's balance from the journal and
diffing against the rail/PawaPay/exchange API. Any non-zero diff pages an operator.
This is how you *detect* the failure modes in §1 rather than discovering them in a
support ticket.

### Idempotency

Two layers:

1. **Inbound idempotency** — key on `(rail, txid/payment_hash, vout)`. A webhook
   delivered twice produces one credit. Webhook handlers are pure upserts on this key.

2. **Payout idempotency** — generate one `idempotency_key` per payment at the
   `FX_LOCKED → PAYOUT_REQUESTED` transition, persist it *before* the API call, and
   send it on the PawaPay request. On retry, reuse the same key so PawaPay dedupes.
   The `ref` the UI shows (`MMM-2026-418842`, `send.jsx:498`) is a good human-facing
   anchor for this key.

```
async function requestPayout(payment) {
  // key persisted in the same txn that wrote FX_LOCKED — survives a crash here
  const key = payment.payout_idempotency_key;
  const res = await pawapay.disburse({ idempotencyKey: key, ...payment.payout });
  // on network timeout: DO NOT resubmit. Re-query by key, or → MANUAL_REVIEW.
}
```

All webhook endpoints: verify signature, check replay window, dedupe by event id,
then enqueue. Processing is a separate, retryable worker reading the durable queue.

---

## 3. FX quote / expiry / hedging

The mock's `quote()` (`send.jsx:11-13`) is `xaf * 1.025`. The real engine must price
**volatility risk over the confirmation window**, because that window is when you're
exposed.

### Quote object

```
Quote {
  id, payment_id,
  inbound_asset,            // BTC | USDT
  inbound_amount,           // what the user must send (asset units)
  xaf_delivered,            // what the recipient receives (fixed)
  rate, spread_bps,
  rail,                     // LIGHTNING | ONCHAIN | TRON — fee differs per rail
  fee_xaf,
  issued_at, expires_at,    // TTL is rail-dependent (below)
  hedge_policy              // NONE | LOCK_ON_CONFIRM | PRE_HEDGE
}
```

### TTL by rail (exposure window drives the spread)

| Rail | Quote TTL | Confirmation window | Spread posture |
|---|---|---|---|
| Lightning | 60–90 s | seconds (HTLC held) | tight — near-zero exposure |
| TRON/USDT | 2–3 min | ~1 min | tight — stable asset + fast |
| On-chain BTC | **re-quote model** | 10–60 min | wide, or hedge on detect |

For on-chain you cannot honor a 60-second rate for an hour. Two viable models:
- **Re-quote:** lock XAF only at `INBOUND_CONFIRMED`; show the user an *estimate* with
  an explicit "final rate set on confirmation" disclosure. Simplest, pushes risk to user.
- **Pre-hedge:** at `INBOUND_DETECTED` (mempool), open a short BTC position sized to the
  inbound so PnL offsets the spot move during confirmation. Lets you *guarantee* the
  quoted XAF. Requires an exchange/derivatives integration and margin — this is the
  treasury build (§4).

v1 recommendation: **Lightning/TRON honor a locked quote** (cheap, low risk); **on-chain
uses re-quote-on-confirm** with clear UX, and add pre-hedging only when on-chain volume
justifies the treasury complexity.

### Rate sourcing

- Spot from ≥2 independent sources (exchange + aggregator); reject quote if they diverge
  beyond a threshold (stale/manipulated feed guard).
- EUR/XAF is the **fixed 655.957 peg** — only BTC/EUR and EUR/USD actually move. Price
  off EUR, not USD, to match the real hedge instrument.
- Spread covers: volatility over TTL, hedge cost, rail inbound fee, payout fee, margin.
  The flat 2.5% becomes a computed, per-rail, per-corridor number.

---

## 4. Treasury / float (the dependency nobody draws)

PawaPay pays out from **pre-funded XAF** held in-country. You front the recipient before
the crypto is liquidated. So you run two pools:

- **XAF payout float** — sized to peak in-flight payout volume + buffer. Auto-alert and
  replenish below threshold. This is the cap on how much you can pay out per day.
- **Crypto liquidation pipeline** — confirmed inbound BTC/USDT → exchange → EUR/XAF →
  back to float. Latency here is why float must lead volume.

The ledger's `payout_float_XAF` account is the live source of truth; FX-lock reserves
against it so two concurrent payments can't both spend the last of the float.

---

## Build order (v1)

1. **Ledger + idempotency** (§2) — everything else writes to it; build it first.
2. **State machine + webhook ingestion** (§1) — durable, signature-verified, replay-safe.
3. **Lightning + TRON happy path** with locked quotes (§3) — lowest FX risk, ships value.
4. **PawaPay payout** with idempotency keys + `MANUAL_REVIEW` on ambiguity (§1, §2).
5. **Reconciliation jobs** — three-way (rail ↔ ledger ↔ PawaPay), daily then continuous.
6. **On-chain BTC** with re-quote model (§3) — added once #1–5 are solid.
7. **Treasury/float automation + pre-hedging** (§4) — when volume justifies it.

Deferred but must-decide-before-launch (from the review, not re-spec'd here):
KYC/AML & licensing posture, name-verification integration (PawaPay name lookup),
and the refund-asset/rate policy.

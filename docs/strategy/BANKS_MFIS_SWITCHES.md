# Plugging in banks, MFIs and national switches

**Written:** 2026-10-22 · Grounded in what the codebase actually does today, checked while
writing rather than remembered.

---

## 1. The gate is membership, not an API key

You cannot connect to GIMAC by signing up. A switch has *participants*, and participation
is licensed. That gives three postures, and they are different businesses wearing the same
code:

| Posture | Who holds the licence | Who holds settlement risk | Speed |
|---|---|---|---|
| **Technical service provider** to a participant | the bank / MFI | them | fastest |
| **Sponsored aggregator** behind a member bank | the sponsor | the sponsor (priced accordingly) | months |
| **Direct participant** | us | us, at BEAC | quarters, capital-intensive |

Posture decides who holds the float and who answers to COBAC. It does not change much of the
code. Payfonte's GIMACPAY offer is, in substance, them selling us posture 2.

Pick the posture before the protocol. Everything below is cheap by comparison.

## 2. What already works, today

More than I expected before checking.

**A bank or MFI with a request/response API is just another adapter.** `PayoutAdapter` and
`CollectAdapter` do not care that the counterparty is a bank: `disburse` / `queryStatus` /
`balance` / `verifyCallback` map directly, and priority ordering, balance-aware selection,
health-aware routing and automatic failover come free. That is most of a Tier-1 bank
integration already done.

**Statement reconciliation is built and running.** `core/interop/reconcile.ts` compares a
provider's own statement (`PayoutAdapter.listPayouts()`) against our payments and issues a
verdict per row — `matched`, `missing_internal`, `amount_mismatch`, `state_mismatch`,
`unattributed`, `pending` — falls back to per-payment re-query for rails without a
statement, and the sweep runs unconditionally in the job loop, notifying an operator once
per new mismatch. This is the hard half of a batch rail, and it is production machinery
rather than a plan.

**The surrounding model is there too:** `BANK_ACCOUNT` is already an `IdentifierType`;
counterparties and aliases exist; `/v1` separates `settlements` and `settlement-intents`
from payments; the ledger is double-entry; compliance is hash-chained for CEMAC.

## 3. The four things that break — one of them dangerously

### 3.1 Authorisation is not settlement

`DELIVERED` in our state machine means *the money reached the recipient*. On a switch, the
message succeeds now and value moves at a cut-off, in central bank money, hours or a day
later.

**If a switch ACK is mapped to `DELIVERED`, we release the sender's crypto against money
that has not settled.** That is the same rule we already enforce per-rail — never promote a
status we cannot prove — at a scale where the gap is a working day instead of a second, and
where the counterparty is a bank rather than an aggregator.

Checked while writing: there is **no value-date, cut-off or netting concept anywhere** in
the codebase. The only `cutoff` identifiers are garbage-collection horizons. This is the one
real architectural hole, and it is not small: deferred settlement changes what a terminal
state means.

### 3.2 Many MFIs have no API at all

The rail is SFTP and a CSV, and the truth arrives as a statement at T+1. We have the
reconciliation engine for this (§2) but no adapter *shape* for "there is no callback, ever,
and `queryStatus` cannot be asked" — and no collect-side equivalent of `listPayouts()`.

### 3.3 Addressing

MSISDN is the anchor throughout: operator detection from prefix, `checkPhone`, routing. A
bank needs account number + bank code, or an IBAN, or a switch alias. The identity layer
anticipates this; the payment path does not.

### 3.4 Message standards

ISO 8583 for card switches — dual-message, authorisation then clearing, which is §3.1 made
concrete in a wire format. ISO 20022 `pacs.008` / `pacs.002` for instant-payment schemes.
Both are a different encoding *and* a different lifecycle.

## 4. What each counterparty actually needs

| | Rail shape | Settlement | Addressing | Realistic effort |
|---|---|---|---|---|
| **Bank, modern API** | request/response, webhooks | often same-day, sometimes deferred | account + bank code | **days** — an adapter |
| **Bank, host-to-host** | SFTP batch + MT940/CAMT statement | T+1, value-dated | IBAN / account | weeks |
| **MFI, networked** | API via their network (e.g. CAMCCUL) | deferred | member + account | weeks |
| **MFI, standalone** | SFTP/CSV, no callbacks | T+1 statement | account number | weeks, mostly §3.1 + §3.2 |
| **National switch** | ISO 8583 / ISO 20022 | netted, cut-off windows, BEAC | alias / PAN / IBAN | **quarters** — and almost all of it is membership, certification and scheme testing, not code |

## 5. The change I would make — and the one I would not make yet

**Would:** a third adapter class for *deferred* rails, beside payout and collect, where

- the terminal state is `SETTLED`, reached by a **statement**, not a status poll;
- every instruction carries a **value date** and a cut-off window;
- authorisation has its own state and **cannot** promote to `DELIVERED`;
- reconciliation is statement-driven — which is the part already built.

**Would not, yet:** write that interface today. There is no counterparty to write it
against, and an interface designed for an imagined MFI is how you get the wrong abstraction
and then defend it. Every adapter we have was shaped by a real provider's actual behaviour —
including the surprises that no document mentioned, which is where most of the value in
those files now sits. The deferred class should be cut against the first real statement
file we are given, not before it.

## 6. Where to start

**An MFI on batch files, not a bank, and not a switch.**

- It forces the deferred-settlement model into existence against a low-stakes counterparty,
  which is exactly where you want to learn that a terminal state now has a date attached.
- It is posture 1: they hold the licence, we hold no settlement risk.
- It reaches rural last-mile, where Mobile Money is weakest — a reason for a customer to
  choose us that is not a rate card.
- The expensive half, reconciliation, already exists and already runs.

Starting with a switch means spending a quarter on membership and certification *before*
finding out whether the settlement model is right.

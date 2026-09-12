# Reconciliation

Three layers already run:

1. **Per-payment re-query** — Lightning invoices (`reconcileStuckInbounds`), payouts
   (`reconcileStuckPayouts`, `reconcileFailedPayouts`), refunds (`reconcileStuckRefunds`).
2. **Deposit reconcile** — the rail's deposit list + the chain (ERC-20 receipt / Bitcoin
   outputs) settles USDT, USDC and on-chain BTC without a webhook, deduped by the rail's id.
3. **Report** — `GET /api/v1/reconciliation` (admin): our records vs the provider's deposit
   list over the last days, each movement classified `matched | amount_mismatch |
   unattributed | missing_internal | pending`, with the ledger amount beside the provider's.

Payout-side listing (Peexit/PawaPay statements) slots into the same report when their
APIs expose one.

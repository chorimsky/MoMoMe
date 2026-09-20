# Reconciliation

Existing: Lightning (invoice ↔ inbound ↔ settlement in the V1 state machine, IBEX confirmation re-query), stablecoin deposits (tx hash ↔ IBEX account ↔ ledger, `depositReconcile`), Mobile Money (payout ↔ provider statement ↔ balance), network (`shadow.ts reconcile()`), ledger invariants tests.

Added: `reconcileIntent(intent)` — expected (intent amount) vs actual (V1 `xaf` / network quote), variance, notes (review holds, unbalanced network ledger) → `RECONCILIATION_REQUIRED` on the intent when the engine it mirrors is in MANUAL_REVIEW; stablecoin `ChainTx.reconciliation = REQUIRED` on timeout / reorg / no monitor. Admin: `GET /api/admin/upi/intents/:id/reconcile`. Nothing disappears silently.

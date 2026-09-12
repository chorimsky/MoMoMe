# Reconciliation

Three layers already run:

1. **Per-payment re-query** — Lightning invoices (`reconcileStuckInbounds`), payouts
   (`reconcileStuckPayouts`, `reconcileFailedPayouts`), refunds (`reconcileStuckRefunds`).
2. **Deposit reconcile** — the rail's deposit list + the chain (ERC-20 receipt / Bitcoin
   outputs) settles USDT, USDC and on-chain BTC without a webhook, deduped by the rail's id.
3. **Report** — `GET /api/v1/reconciliation` (admin), both directions, each record tagged
   `scope: deposits | payouts`:
   - **deposits** — our records vs the provider's deposit list over the last days, each
     movement `matched | amount_mismatch | unattributed | missing_internal | pending`, with
     the ledger amount beside the provider's.
   - **payouts** — the provider's payout statement vs our payments. Peexit lists every
     request of the last 3 days (`listPayouts` on the adapter), so a payout we have **no
     payment for** surfaces as `missing_internal`: money left the float with nothing behind
     it. PawaPay has per-payout status only, so each of our payouts in the window is
     re-queried. The provider's final status is compared with our state (`payoutVerdict`,
     pure and tested):

     | we say | provider says | verdict |
     |---|---|---|
     | DELIVERED | COMPLETED | matched |
     | FAILED / REFUNDED | FAILED | matched |
     | DELIVERED | FAILED or still pending | **state_mismatch** — recipient told "paid", not paid |
     | FAILED / REFUNDED | COMPLETED | **state_mismatch** — recipient paid AND sender refunded |
     | PAYOUT_REQUESTED | anything | pending |
     | any | amount differs | amount_mismatch |

   The report never changes a payment: `reconcileStuckPayouts` settles, the report tells.
   Simulated (sandbox) rails are skipped — a fake statement has no verdict worth reading.
   Admin → Rails → Interoperability shows the table and counts `state_mismatch` in the red
   headline number.

A payout adapter joins payout reconciliation by implementing `listPayouts()` (statement) or
nothing at all (`queryStatus` is already mandatory and is used per payment).

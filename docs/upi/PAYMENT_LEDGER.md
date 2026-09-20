# Payment ledger (UPI layer)

Money is booked once, by the engine that moves it: the V1 ledger (`core/ledger.ts`, inbound clearing, customer wallet, fx position, fees, payout) and the network ledger (`network_ledger`). The UPI layer adds the thread: `LedgerRefs` on every intent — correlation_id, payment_intent_id, quote_id, route_id, settlement_id, v1PaymentId / networkTxId, provider_reference, blockchain_txid, mobile_money_reference — filled from the V1 record (`refsOf`). Idempotency is inherited: the V1 quote is claimed once, the payout key is the payment ref, the stablecoin lifecycle never re-broadcasts.

Metrics (`core/upi/ledger.ts metrics`): payment_total/success/failed, settlement_success/failed, route_selection_total, route_failure_total, liquidity_reservation_total/failure_total, stablecoin_transaction_total, lightning_payment_total, mobile_money_payment_total, identity_resolution_total — on `/api/admin/upi`.

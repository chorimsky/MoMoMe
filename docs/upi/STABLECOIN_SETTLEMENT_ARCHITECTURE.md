# Stablecoin settlement — abstraction, honestly bounded

What exists: USDT/USDC **on Ethereum**, **received** into IBEX accounts (custodial), reconciled by tx hash. What does not exist: any key, signer, broadcaster, swap, or other network.

- Asset model (`core/upi/assets.ts`): `USDT/ETHEREUM`, `USDC/ETHEREUM` = RECEIVE_ONLY (ACTIVE only when `STABLECOIN_SETTLEMENT_ENABLED` + the asset flag); `USDT/TRON`, `USDC/BASE` = PLANNED with no adapter. `validateAssetNetwork` refuses `USDT` without a network and any PLANNED pair.
- Adapter (`core/upi/rails.ts stablecoinRail`): quote/health real; `initiate` mints the V1 receive instruction (address) — the only outbound path is the IBEX treasury sweep, Super-Admin gated, not driven from here.
- Lifecycle (`core/upi/chain.ts`): CREATED → BROADCASTING → BROADCAST → CONFIRMING → CONFIRMED → FINALIZED; FAILED / EXPIRED / REORGED. Confirmation policy per network (`NETWORKS`): Ethereum 12 / 32 / 120 min. A transfer not seen or not advancing within the timeout is `reconciliation: REQUIRED` and is **never re-sent** by code (Test 8).
- Monitor abstraction: `BlockchainMonitor { watchTransaction, getTransactionStatus, getConfirmations, getBlock, getBalance, getTokenBalance }`; implemented for Ethereum via the receipt reader the deposit reconcile already trusts; other networks → immediate RECONCILIATION_REQUIRED.
- Fees are separate lines: network, provider, momome, fxSpread, liquidity.
- **Phase 13 (first real outbound network adapter) is blocked** until STABLECOIN_CUSTODY_MODEL.md is decided. No unsafe custody is invented.

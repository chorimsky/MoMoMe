# Stablecoin custody model — decision required

**Current, factual:** `THIRD_PARTY_CUSTODIAL`. USDT/USDC (Ethereum) deposits land in IBEX Hub accounts that IBEX controls; MoMo›Me holds API credentials, not keys. Outbound is the IBEX-executed treasury sweep (Super Admin). No private key, signer, mnemonic or RPC broadcaster exists in this repository, and none was added.

**Before any stablecoin *settlement* (outbound to a recipient's address) is enabled**, the operator must choose and document one of: NON_CUSTODIAL · CUSTODIAL · THIRD_PARTY_CUSTODIAL (extend IBEX outbound) · OMNIBUS · USER_CONTROLLED · PARTNER_CONTROLLED — with the legal/compliance architecture it implies (CEMAC: COBAC's position on crypto; CTR/STR duties already in `core/compliance.ts`). Until then `STABLECOIN_SETTLEMENT_ENABLED` stays false, `stablecoinRail.initiate` only mints *receive* instructions, and Phase 13 is **blocked** — recorded here rather than worked around (rules 8, 43).

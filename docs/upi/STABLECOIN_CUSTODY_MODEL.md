# Settlement & custody model — DECIDED 2026-09-20

**No custody. Every payment settles. The system holds nothing.**

| question | answer |
|---|---|
| Does MoMo›Me hold customer funds in any asset? | **No.** Inbound value (Lightning, USDT/ETHEREUM, USDC/ETHEREUM, Mobile Money collection) is converted at confirmation and paid out as local money in the same flow. |
| Is a stablecoin ever a *destination*? | **No.** `getDestinations()` never lists STABLECOIN or BANK; there is no outbound stablecoin send, no stablecoin balance, no key material. |
| What are stablecoins then? | **Funding rails** (pass-through), exactly as Lightning is. `Asset.status = RECEIVE_ONLY` is the model, not a gap. |
| Who holds what, transiently? | The crypto rail (IBEX Hub, custodial on its side) between confirmation and conversion; the payout rails' XAF float (Peexit / PawaPay) — operating float, not customer balances. Residual fees/spread are swept by the Super-Admin treasury sweep. |
| What if money is confirmed in but not paid out? | It is a held balance, which the model forbids: V1 refunds a failed payout to the sender; the UPI tick marks an intent `RECONCILIATION_REQUIRED` after `UPI_SETTLE_WITHIN_MIN` (30) and warns; nothing is ever silently kept. |
| Cross-border? | Value crosses over Lightning and lands in the destination market's local float, then pays out — the same pass-through (network layer). |
| Custody classes considered | NON_CUSTODIAL · CUSTODIAL · THIRD_PARTY_CUSTODIAL · OMNIBUS · USER_CONTROLLED · PARTNER_CONTROLLED — **rejected**; the product is a settlement pipe, not a wallet. |

Code: `SETTLEMENT_MODEL` in `core/upi/assets.ts`; stablecoin capability `send:false, settlement:false` unconditionally; `stablecoinRail.initiate` mints receive instructions only; `flagUnsettled()` in the reconcile tick.

Consequence for the blueprint: Phase 13 ("first real stablecoin network adapter" for *sending*) does not exist in this product. Adding a stablecoin **network** means adding a deposit rail for it (a provider that accepts USDT/TRON deposits and converts) — never a signer.

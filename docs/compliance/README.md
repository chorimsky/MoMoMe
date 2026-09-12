# Compliance

What exists today, and where:

- **Identity**: `core/identity.ts` (latent identity per number, claim via OTP), `core/
  account.ts` (device anchored to a phone via OTP), merchant verification (OTP to the
  settlement number). Registered names from the operator/PawaPay resolver; a name mismatch
  on a payment is a challenge the sender must answer (`confirm_recipient`).
- **Transaction monitoring & limits**: per-corridor `MIN_XAF`/`MAX_XAF`, per-operator
  payout caps, manual-approval threshold (Settings), kill-switch, low-trust merchant hold,
  over/under-payment guards, duplicate-deposit liability booking.
- **Audit**: `core/compliance.ts` hash-chained event log (tamper-evident with
  `COMPLIANCE_HMAC_KEY`), STR/CTR generation, case disposition. Every payment carries its
  `events[]` timeline; every provider callback is in the normalised event log.
- **Store-review access**: fixed reviewer number that can never be paid.

The interop layer records `complianceStatus` / `riskStatus` on the intent and a `compliance`
check on each route. The `ComplianceEngine` interface (verifyIdentity / verifyBusiness /
screenTransaction / calculateRisk / checkLimits / approve / reject / review) is realised
today by these modules; sanctions screening and KYB providers plug in behind the same
route check without touching routing or execution.

## The engine in force (`core/interop/compliance.ts`)

`ComplianceEngine` — verifyIdentity / verifyBusiness / checkLimits / screenTransaction /
calculateRisk — is implemented by `rulesEngine` and consulted in two places: the router's
`compliance` check on every route, and `createPaymentCore` before anything is minted.

| Verdict | Cause | Effect |
|---|---|---|
| **blocked** | watchlist match (number or name); a velocity limit exceeded | payment refused at creation (403 `compliance_blocked`, neutral message); operator notified; nothing to refund |
| **review** | amount at/above the CDD trigger; within 80 % of a velocity limit | payment created and stamped with `complianceFlags`; the pay-in is accepted; **settlement holds** for an operator |
| **clear** | nothing flagged | straight through (the approval threshold still applies at settlement) |

Velocity limits live in Settings → Compliance: per sender 24 h XAF, per recipient 24 h XAF
(across all senders), payments per sender per hour; 0 switches one off. Defaults 2 000 000
XAF / 2 000 000 XAF / 20. Risk score 0–100 is derived from the flags for operators.

Swapping in a screening or KYB provider means implementing the interface and calling
`setComplianceEngine()`; routing and payment creation do not change.

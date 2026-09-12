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

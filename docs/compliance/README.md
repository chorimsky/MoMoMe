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

## Regulatory reporting (`core/regulatory.ts`) — one period, every body

`GET /admin/regulatory?period=YYYY-MM` computes, from the books, what each authority is
owed for the month; `GET /admin/regulatory/export?body=…&period=…` is the sectioned CSV
attached to the submission; `POST /admin/regulatory/file` records the filing (with the
body's receipt reference) as a `REPORT_FILED` event on the tamper-evident compliance
chain, so "we filed on the 4th" is provable. Console: Admin → Compliance → *Regulatory
filings* (calendar, per-body figures, export, mark filed). Filing rights follow STR rights
(compliance officer / super admin); the ANIF register stays officer-confidential.

| Body | Report | Basis | Due | Contents |
|---|---|---|---|---|
| **BEAC** | Monthly declaration, Annexes I–III | Instruction N°002/GR/2026 (inbound remittance pre-financing to Mobile Money wallets) | 5th of the following month | **I** funds received by asset/method (what arrived, USD, XAF gross of fee); **II** wallet credits by operator/country/aggregator (net XAF); **III** technical partners (identity, role, country, configured/live); repatriation evidence = treasury sweeps and how many carry a marked sale; refunded-not-credited totals |
| **ANIF** | STRs (déclarations de soupçon) | Règlement N°02/24/CEMAC/UMAC/CM | *sans délai* | STRs filed in the period; open cases and the age of the oldest escalated case (the "without delay" measure) |
| **ANIF** | Large-transaction register (CTR) | Règlement N°02/24 (≥ CTR threshold, 5 000 000 XAF default) | held; summarised monthly | count and XAF at/above the threshold; the register export |
| **COBAC** | Annual AML/CFT internal-control report | R-2023/01 (responsable conformité) | annual — confirm the date with COBAC | officer, CDD counts, thresholds and velocity limits in force, cases by type, dispositions, STRs, chain integrity, year-to-date volume |
| **DGI** | VAT return (TVA) | CGI — 19.25 % (17.5 % + 10 % CAC) | 15th of the following month | VAT carved out of (or added to) the platform fee, by day |
| **DGI** | Corporate-income-tax advance (acompte IS) | CGI — 2.2 % (2 % + CAC) of turnover ex-VAT | 15th of the following month | turnover = fees ex-VAT + realized FX from sweeps marked sold; year-to-date advances and an indicative IS at 33 % (before costs) |
| DGI (info) | Mobile-money levy | Finance Law 2022 — 0.2 % on transfers/withdrawals, **collected by the operators** | — | exposure on the payout volume; not owed by the platform |

Rates live in Settings → Tax (`settings.tax`: `vatRatePct`, `feeIncludesVat`,
`turnoverAdvancePct`, `corporateRatePct`, `momoLevyPct`, `filingDay`, `taxId`) so a Finance
Law changes a number, not code. **Every tax figure is an estimate**: the base assumes the
platform fee is the service supplied in Cameroon; the operating entity's status (see the
site footer — software by Bitbase Technologies Inc., regulated services by the applicable
operating entity) decides what is actually due. The accountant files; the console prepares.

Still manual / external: submission to BEAC's portal and the DGI télédéclaration, the ANIF
transmission channel, the COBAC submission date, a daily UNSC list feed, tiered KYC
document capture, and the repatriation-proof payout gate itself (the report evidences
sweeps; it does not yet block a credit that precedes proof).

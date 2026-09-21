# API v1 — Plans, usage, billing, limits

Plans (`core/platform/billing.ts`, admin-editable): developer (60 rpm / 15 on payments / 1.5 %),
business (300 / 60 / 1.2 % with volume tiers), enterprise (1200 / 300 / negotiated). The quote engine takes
the organization's effective fee through `effectiveFeePct(org, env)` (tiers by this month's live volume).
Usage (`core/platform/usage.ts`): per org × env × UTC day — requests by class, errors, latency, quotes,
payments, completed, failed, volume, fees, webhooks, settlements. Invoices are built from usage per month
(draft → issued → paid) from Admin → Platform; a correction is a new credit-note invoice, never an edit.
Limits (`core/platform/limits.ts`): rules with scope (org/env/country/asset/currency/operator/plan) and
ceilings (min/max per transaction, daily, monthly, velocity per hour, daily count). Two defaults exist
(live, test); nothing country-specific is in code.

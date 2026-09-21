# API v1 — Operations runbook

Admin → API Platform:
- Organizations: KYB status, plan, **Enable live** (step-up), suspend/reactivate, credit a balance (only for money
  actually collected on the org's behalf), set a developer's password, build/issue/mark-paid invoices.
- Settlements: REQUESTED → Approve → pay from treasury → Mark submitted (provider ref) → Complete; Fail returns funds.
- Pricing plans, limit rules (JSON editor), usage by organization, audit.
- Treasury KPIs: float, reserved by open API payments, settlement pending, available.

Health: `GET /v1/health` (public) and `/health/deep` (existing). Alerts: an org whose webhook endpoint is
disabled after 50 failures appears in the developer dashboard (and `outboundStats`).
Support: ask the developer for `meta.request_id`; `GET /v1/transactions/{id}` (their credential) or Admin →
Payments (ref) gives the full timeline; the audit trail names the credential that created it.

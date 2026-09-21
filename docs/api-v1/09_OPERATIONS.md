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

## Developer accounts (added 2026-09-22)
- Sign-up asks for the wanted plan: everyone starts on **developer** (sandbox at once); business/enterprise
  becomes a `plan_change` request in **Admin → API Platform → Activation queue**.
- The queue holds KYB submissions (company details from the dashboard's **Go live** tab), plan changes and
  live-access requests. **Approve** applies the change (KYB verified / plan / liveEnabled) and emails the
  developer; **Reject** requires a reason, which is emailed. Live access cannot be requested before KYB.
- Email: verification, password reset, invitations and decisions go through `core/platform/email.ts`
  (EMAIL_API_KEY / EMAIL_FROM, Resend-compatible). Unconfigured: every message is still recorded in the
  outbox (Emails tab) and, in the sandbox, the action link is returned to the caller; in live the operator
  can still "Set password" for a developer.
- Sessions: 12-hour tokens carrying a per-user version; "Sign out everywhere", a password change and a
  password reset bump the version and end every earlier session server-side.

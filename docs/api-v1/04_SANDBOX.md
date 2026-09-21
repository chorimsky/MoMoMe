# API v1 — Sandbox

A sandbox is a deployment with `RAILS_MODE=sandbox` and no live rail configured (`liveMoney()` false):
`deploymentEnv()` = "test", `mm_test_` credentials are accepted, `mm_live_` refused with `environment_mismatch`.

Reserved recipient numbers (`core/platform/sandbox.ts`): see the portal "Sandbox scenarios" —
PAYMENT_FAILED +237670000001, MANUAL_REVIEW +237670100002, INSUFFICIENT_LIQUIDITY +237670200003,
PROVIDER_UNAVAILABLE +237670300004, PAYMENT_TIMEOUT +237670400005, PAYMENT_DELAYED +237670500006.
`POST /v1/sandbox/payments/{id}/pay` simulates the wallet paying.

Credentials issued on production for the test environment are honoured by the sandbox through
`core/platform/sync.ts` (hash-only, HMAC-signed lookup, 10-minute adoption). Set on the sandbox:
`PLATFORM_ORIGIN_URL=https://<production api>` and `PLATFORM_SYNC_SECRET=<shared>`; on production
`PLATFORM_SYNC_SECRET=<same>`. Without them the sandbox only knows credentials created on it.

Local: `.claude/launch.json` → `momome-server-identity` + `momome-app`; sign up at
http://localhost:5173/developers/dashboard, create a test credential, call http://localhost:4000/v1.

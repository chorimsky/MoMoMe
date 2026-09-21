# API v1 — Webhooks

Transport: `core/interop/outbound.ts` (existing signed delivery with backoff and dead-letter),
extended with typed events and per-organization ownership (`org:<orgId>`).

- Delivery: `POST <url>`, headers `X-MoMoMe-Signature: t=<unix-ms>,v1=<hex hmac-sha256(secret, t + "." + rawBody)>`,
  `X-MoMoMe-Event-Id: evt_…`, `User-Agent: MoMoMe-Webhooks/1`. Body `{ id, object:"event", type, created_at, livemode, data }`.
- Retries: 1 s → 10 s → 1 min → 10 min → 1 h → dead (replayable). 50 consecutive failures disable the endpoint.
- Once per public state per payment (`announcedState`), so a redelivered rail webhook never double-fires.
- `payment.created` and `payment.awaiting_payment` are emitted by the /v1 handler after creation (the
  engine's creation transitions run before the org meta exists); every later state comes from the
  transition hook (`core/platform/hooks.ts` → `setV1Projector`).
- URLs must be public HTTPS in live (SSRF guard in `validCallbackUrl`); the sandbox allows http for local receivers.
- Test: `POST /v1/webhooks/{id}/test` sends `ping`. Replay: `POST /v1/webhooks/{id}/replay { event_id }`.
- Verification helpers ship in all three SDKs (`verifyWebhookSignature`).

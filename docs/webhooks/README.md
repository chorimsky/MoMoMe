# Webhooks and events

Inbound (providers → MoMo›Me), all under `/webhooks/*`: `ibex`, `phoenixd`, `peexit`,
`pawapay`, `payout/:name`, `whatsapp`, `peex`. Each is verified by its adapter, acked fast,
processed asynchronously, and settled only on an authoritative re-query where the rail
supports one.

Every callback becomes a `PaymentEvent` (`core/interop/events.ts`): provider, event type,
provider reference, payment id, **payload hash** (never the body), received/processed
times, status `received | verified | rejected | duplicate | processed`. Identical bytes
from the same provider are marked `duplicate` and not processed again.

`GET /api/v1/webhooks/events` (admin) lists them with counts by status and provider; a
rising `last24hRejected` is the first sign of a misconfigured secret or an attack.

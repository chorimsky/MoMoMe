# API v1 — Tests

`server/test/api-v1.test.ts` (81 assertions, in the chain): developer sign-up → credential; envelope and
request ids; environments; the §44 critical flow end to end through /v1 with a signed webhook receiver
(quote → payment → paid → converted → paid out → COMPLETED → webhook → timeline → history → usage);
source-first quotes and the validation vocabulary; scopes; operator limit rules; cancel; refund refusal on a
completed payment; cross-organization isolation; §45 concurrency (12 racers, 20 000 XAF float → 4 created,
8 refused, none twice, liquidity returned on cancel); settlements (balance-backed, operator workflow,
ledger); webhook management (test, deliveries, replay, patch, delete); rotation/revocation/suspension/audit;
sandbox scenarios; the OpenAPI document; long-poll; the TypeScript SDK against the live contract including
webhook signature verification.

Run: `cd server && DB_PATH=:memory: RAILS_MODE=sandbox npx tsx test/api-v1.test.ts` or the full `pnpm test`.

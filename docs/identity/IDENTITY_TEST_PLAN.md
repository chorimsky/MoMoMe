# Identity Test Plan

Suite: `server/test/identity-resolution.test.ts` (in the `pnpm test` chain; 98 assertions). Run alone:

```bash
cd server && DB_PATH=:memory: RAILS_MODE=sandbox IDENTITY_RESOLUTION_ENABLED=true npx tsx test/identity-resolution.test.ts
```

| area | covered |
|---|---|
| Normalisation | `674123456`, `+237674123456`, `237674123456`, `6 74 12 34 56`, `+237 674 12 34 56` → `+237674123456`; Orange prefix; Kenyan number → KE/KES; garbage → `IDENTITY_INVALID_IDENTIFIER`; US → `IDENTITY_UNSUPPORTED_COUNTRY`; Camtel prefix → no operator; hash stable & number-free |
| Name matching | accent/case/hyphen normalisation; MATCH / PARTIAL_MATCH / NO_MATCH / NOT_AVAILABLE |
| Chain | sandbox-only chain without MTN creds; capability table false without an authoritative provider |
| States | VERIFIED (+capabilities, expiry); cache hit + name match; NOT_FOUND; INACTIVE; **timeout → PROVIDER_UNAVAILABLE, never NOT_FOUND, not cached**; UNSUPPORTED |
| Audit & metrics | no 9-digit number in any audit row; counters incl. timeout and cache hit; prune keeps fresh rows |
| API | 401 anonymous / un-enrolled; 400 without purpose; 200 public shape; no provider reference or `sbx-` secret; `no-store`; unavailable & not-found messages; `/verify` NO_MATCH → VERIFICATION_FAILED, MATCH ok; SQL-ish identifier → 400; enumeration sweep → 429; admin `/health` (providers + metrics), non-admin 401; `/providers` has no `key` |
| Payment integration | `/config.identity`; a resolved recipient's payment carries the snapshot with `nameMatch`; an unresolved recipient's payment is unchanged; V1 delivery unchanged; snapshot byte-identical after DELIVERED; `cachedSnapshot` never calls a provider |
| Peexit provider | mocked transport: VERIFIED with name/operator via `POST /clients/verify-wallet` + `SECRETKEY`; 404 → NOT_FOUND; `isValid:false` → INACTIVE; valid-without-name → UNKNOWN; 403 → non-retryable AUTH_ERROR; 422 → UNSUPPORTED_COUNTRY; 5xx / abort → retryable UNAVAILABLE / TIMEOUT; chain and capability table |
| Matcher | the `compareNames` table (accents, order, hyphen/joined, initials, one-edit drift, missing middle name, shared first name only, initials-only) |
| Cache & concurrency | VERIFIED holds hours, NOT_FOUND minutes; three simultaneous lookups = one provider call with per-caller name verdicts |
| Gate mode | server 409 `recipient_unverified` for cached NOT_FOUND; verified still mints; unresolved never refused |
| Admin | status endpoint (flag on/off), hashed audit, support lookup under SUPPORT, 401 anonymous, 404 with the flag off |
| Flag off | `/v2/identity/*` 404; `/config.identity.enabled=false`; no snapshot even with a warm cache |

## Manual / browser
Dev server `momome-server-identity` + `momome-app`; on `/send` type `670123456` (verified card "MTN MoMo Mobile Money · Cameroon"), `670123459` (not found), `670123000` (unavailable + Retry). Verified 2026-09-20.

## Not yet automated
- MTN direct against the MTN sandbox (needs operator credentials on a preview environment).
- Mobile UI states (typecheck only; Expo Go sim gotcha — see memory `mobile-app-parity`).

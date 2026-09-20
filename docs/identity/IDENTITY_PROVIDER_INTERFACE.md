# Identity Provider Interface

File: `server/src/core/identityResolution/providers/types.ts`.

```ts
export interface IdentityProvider {
  name: string;                      // "mtn_direct" | "orange_direct" | "pawapay" | "sandbox"
  authoritative: boolean;            // can it say VERIFIED / NOT_FOUND / INACTIVE?
  configured(): boolean;             // credentials present (never logs them)
  supports(country: string, operator: string | null): boolean;
  resolve(id: NormalizedIdentifier, ctx: IdentityContext): Promise<ProviderAnswer>;
  health(): Promise<IdentityProviderHealth>;
}
export interface IdentityContext { purpose: IdentityPurpose; requestId: string; actor: string; paymentIntentId?: string; timeoutMs: number }
export type ProviderAnswer = Pick<IdentityResolution, "status" | "verified" | "displayName" | "accountStatus" | "capabilities" | "provider" | "error"> & { operator?: string | null };
```

## Contract
- `resolve` returns a `ProviderAnswer` for a definite answer (`VERIFIED`, `NOT_FOUND`, `INACTIVE`, or `UNKNOWN` for hint-only providers).
- `resolve` **throws `IdentityError`** for anything that is not an answer. `retryable: true` (timeout, 5xx, network) lets the resolver try the next provider; `retryable: false` (401/403, malformed response) stops the chain.
- A provider never fabricates a name, never maps a timeout to `NOT_FOUND`, never logs the raw MSISDN (use `identifierHash` / `last4`).
- `health()` must be cheap and must not call the upstream on every tick; report `configured`, `status` (`OK | DEGRADED | DOWN | NOT_CONFIGURED | SANDBOX`), coverage and last latency.

## Implemented providers
| name | authoritative | supports | source of truth | notes |
|---|---|---|---|---|
| `mtn_direct` | yes | `MTN` in `MTN_MOMO_COUNTRIES` (default CM) | MTN MoMo Open API `GET /collection/v1_0/accountholder/msisdn/{msisdn}/active` + `/basicuserinfo` | OAuth token from `/collection/token/`; 404 → NOT_FOUND; `result:false` → INACTIVE; 401/403 → non-retryable AUTH_ERROR |
| `peexit_verify` | yes | `MTN` and `ORANGE` × CM | Peexit `POST /clients/verify-wallet` `{ countryCode, accountNumber }` → `{ isValid, accountName?, operator, status }` (docs: peex-api-docs.peexit.com/verify-wallet) | same `SECRETKEY` and IP allowlist as disbursement, so it answers only from Railway; 404 → NOT_FOUND; `isValid:false` → INACTIVE; 200 without `accountName` → UNKNOWN (never a fabricated name); 401/403 → non-retryable AUTH_ERROR; 422 → UNSUPPORTED_COUNTRY |
| `orange_direct` | yes | `ORANGE` × CM | **not implemented** — honest stub, `NOT_CONFIGURED` until `ORANGE_IDENTITY_API_URL/KEY` and an integration | throws non-retryable unavailable |
| `pawapay` | no | any market pawapay covers | `POST /v2/predict-provider` | operator hint only → `UNKNOWN`; **pawaPay has no account-name endpoint at all** (reviewed 2026-09-20: payouts, deposits and callbacks carry no holder name), so it can never verify |
| `sandbox` | no (counts as an answerer) | everything | deterministic fixtures | exists only when `RAILS_MODE=sandbox && !liveMoney()`; national number ending `9` → NOT_FOUND, `8` → INACTIVE, `…000` → simulated timeout, `670123456` → "NANA JEAN PAUL" |

## Adding a provider
1. Implement the interface in `providers/<name>.ts`; map every upstream outcome to a state or an `IdentityError` with the right `retryable`.
2. Register it in `ALL` in `resolver.ts` and document its env in [IDENTITY_PROVIDER_CONFIGURATION.md](IDENTITY_PROVIDER_CONFIGURATION.md).
3. Add fixtures to `test/identity-resolution.test.ts` for: verified, not found, inactive, timeout, auth error.
4. Ship with the provider **absent** from `IDENTITY_PROVIDER_PRIORITY`; add it per market once its sandbox answers match production semantics.

# MoMo›Me SDKs

Thin clients for the MoMo›Me API v1, aligned with `GET /v1/openapi.json` (every method is an operationId there).

| Package | Path | Install |
|---|---|---|
| `@momome/sdk` (TypeScript / JavaScript) | `sdk/js` | `npm i @momome/sdk` |
| `momome/momome-php` (PHP 8.1+, Laravel provider + facade) | `sdk/php` | `composer require momome/momome-php` |
| `momome` (Python 3.9+, stdlib only) | `sdk/python` | `pip install momome` |

All three: bearer credential → environment (mm_test_ → sandbox, mm_live_ → production), `Idempotency-Key` on writes,
the `{data, meta}` envelope unwrapped, errors as typed exceptions, `waitUntilSettled` long-polling, and a webhook
signature verifier. The TypeScript SDK is exercised against the live contract in `server/test/api-v1.test.ts`.

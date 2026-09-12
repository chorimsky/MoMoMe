# Payment addresses

A phone number is a **payment address**, not a Mobile Money account. `core/interop/
addresses.ts` resolves what a user typed, scanned or pasted:

| Input | Type | Resolves to |
|---|---|---|
| `+237 6 77 00 07 89`, `677000789` | PHONE | operator (MTN/Orange) via `checkPhone`, owner name via the resolver, limits, Lightning Address |
| `lightning:237677000789@momome.xyz` | LIGHTNING_ADDRESS | the same phone destination |
| `https://momome.xyz/send?to=…&amount=…` | PAYMENT_LINK | the phone destination + amount hint |
| `MOM-CM-004525`, `/pay/<code>` | MERCHANT_CODE | the merchant's settlement number, business name, verified flag |

Result: `rails[]` (mobile_money via its operator; lightning for receiving), `owner`
(display name when on file, whether verified), `status` ACTIVE / UNSUPPORTED (with the
phone check reason) / BLOCKED (low-trust merchant) / RESERVED (store-review number),
`limits`. Never exposes internal ids, device ids or anything beyond what a payer is shown
anyway.

Future types (EMAIL, ACCOUNT_REFERENCE, QR) are in the enum; the resolver returns `null`
for what it cannot classify, and the API answers 404 `unresolvable`.

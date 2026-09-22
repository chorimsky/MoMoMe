# MoMo›Me Merchant Ecosystem — implementation architecture

Product blueprint: turn MoMo›Me into a **payment-acceptance network**. This doc maps that
blueprint to the codebase — what to reuse, the data model, auth, and a phased build. The
product "what/why" lives in the blueprint; this is the technical "how".

## 0. The core insight (why this is mostly composition, not new infra)

A **merchant payment is a normal payment whose `recipient` is the merchant's settlement
Mobile Money number.** The settlement engine (crypto inbound → FX → MoMo payout), receipts,
LNURL receive, and device-account auth already exist. The merchant layer is mostly:

- a **merchant profile** (identity + settlement account) on top of a device account,
- **payment links / QR** that deep-link the existing send flow, pre-filled to the merchant,
- a **dashboard** that reads the merchant's sales = payments to their settlement number.

We reuse: `stateMachine`/`store` (payments), `Receipt` (Success.tsx), `QR` (atoms), device
keypair auth (`ownerOf`), anchor OTP (`account.ts`, proves settlement-number ownership),
the developer API (merchants who code), and the resolution-graph `Merchant` (payee intel).

## 1. Data model (new: `core/merchantAccount.ts`, `shared/types.ts`)

```ts
type MerchantTier = "individual" | "business";
type MerchantStatus = "pending" | "active" | "suspended";

interface MerchantAccount {
  id: string;              // internal
  code: string;            // public identity, e.g. "MOM-CM-004523"
  owner: string;           // device/account id that controls it (ownerOf) 
  businessName: string;
  category: string;        // "Restaurant", "Freelancer", …
  country: CountryCode;
  settlementPhone: string; // Mobile Money number that receives payouts (verified)
  provider: ProviderId;    // MTN / ORANGE (detected from the number)
  location?: { label?: string; lat?: number; lng?: number };
  tier: MerchantTier;
  status: MerchantStatus;
  verifiedPhone: boolean;  // settlement-number ownership confirmed via OTP
  createdAt; updatedAt;
}

interface MerchantLink {         // a reusable "charge me" link / QR
  code: string;                  // short public code → /pay/<code>
  merchantId: string;
  amountXaf?: number;            // fixed amount, or open (customer enters)
  label?: string;                // "Table 4", "Invoice #20260045"
  kind: "link" | "qr" | "invoice";
  createdAt; disabledAt?;
}
```

- **Identity `MOM-CM-######`**: `MOM` + country + zero-padded sequence (persisted counter).
- Attribution: tag the created payment with `merchantId` when paid via a merchant link
  (add `Payment.merchantId?`), so sales attribution is exact, not just phone-matching.

## 2. Auth (reuse the device account)

A merchant onboards **on their device**; the device keypair (Phase-2 `ownerOf`) owns the
account — same zero-signup model as consumers. Settlement-number ownership is proven with
the existing **anchor OTP** (`requestAnchor`/`verifyAnchorCode`) sent to the settlement
number. Multi-device merchant access later rides the same phone-anchor/recovery path.
No new session system.

## 3. Endpoints (routes/api.ts)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/merchant` | device | Create profile (name, category, settlement phone, location) → `pending` |
| POST | `/merchant/verify` | device | Confirm settlement phone via OTP → `active` |
| GET | `/merchant/me` | device | My merchant account (or 404) |
| GET | `/merchant/me/sales` | device | Payments to my settlement number (dashboard feed) |
| POST | `/merchant/links` | device | Create a payment link/QR/invoice |
| GET | `/merchant/links` | device | My links |
| GET | `/pay/:code` (public) | — | Resolve a link → merchant display + amount (for the pay page) |

Developer-API partners get the same via their API key (`ownerOf` already resolves keys).

## 4. Client

- `/merchant` — onboarding (if no account) → **dashboard** (overview: today's sales /
  txns / avg + settlement status; sales list; Payment Tools: QR + link + invoice).
- `/pay/:code` — public **pay page**: shows "Paying **{business}**" + amount, then runs the
  existing send flow pre-filled (recipient locked to the merchant, `merchantId` tagged).
  QR encodes `https://momome.xyz/pay/<code>`.
- Reuse `Receipt` for the digital receipt; nav entry "For business → /merchant".

## 5. Phased build

- **Phase 1 (MVP loop)** — onboard → identity → create link/QR → customer pays (`/pay/:code`
  prefilled) → merchant sees it in the dashboard. *(This is the growth-loop core.)*
- **Phase 2** — invoices (due date, client), fixed vs open amounts, link management, CSV.
- **Phase 3** — verification tiers (business registration/tax as volume grows), Verified badge.
- **Phase 4** — Discovery ("Pay with MoMo›Me" map, opt-in listing) → the network effect.
- **Phase 5** — feeds into the Growth Engine (Step 5): ambassadors, categories, launch.

## 6. Decisions (locked defaults)
- Merchant auth = **device-bound** + settlement-phone OTP (reuse). ✔
- `MerchantAccount` is a **separate** model, cross-referenced to the resolution `Merchant`
  by settlement phone (a self-onboarded merchant can auto-validate its payee record). ✔
- Merchant sales attribution = **`Payment.merchantId` tag** (set on link-paid payments),
  falling back to settlement-phone match for direct/QR-less pays. ✔
- Payment-link amounts: **fixed OR open** (customer enters) — both supported. ✔

## Admin → Merchants (2026-09-22 review)

The operator view now has two areas. **Accounts** — the self-onboarded acceptance accounts
(`/api/admin/merchant-accounts[?q=]`, `…/:id`, `…/:id/{suspend|reactivate|verify|unlist}`): status,
verified number, tier, 30-day and all-time sales, links, the bridged payment identity / API
organization, the graph record's trust state ("Payouts held" when flagged), and other accounts that
settle to the same number. `verify` and `suspend` require admin step-up; every action is audited.
Suspension makes `/merchant/pay/:code` and `/merchant/by-code` answer 404 and drops checkout
attribution — no engine change. **Identity graph** — the learned payee network, now with search,
`unflag` (restores `pending`/`active` and a neutral trust score; lifts the payout hold), a confirmed
merge with a searchable duplicate picker, and a per-record `history` (validated / flagged / unflagged
/ merged, by whom, why) written by the core functions. No existing behaviour changed: validate, flag
and merge keep their signatures with optional `by`/`reason`.

### Merchant dashboard (2026-09-22 review)
`GET /merchant/me/summary` no longer returns raw engine `Payment`s: `recent` is `MerchantSale[]`
(`core/merchantAccount.ts` `merchantSaleView`) — amount, fee, who carried it, method, reference,
the link it came through (code, label, kind, client), created / delivered times — never the payer's
device id, coarse location, pay instruction or payout ids. The summary also carries a 7-day `week`
trend. `GET /merchant/me/sales.csv` exports completed sales (device-signed, same owner guard).
Web and mobile dashboards refresh every 6 s while visible / focused (web marks a sale that was not
in the previous read as NEW for a few seconds and reloads the links so an invoice flips to PAID
at the same moment); a row expands to reference (copy), fee breakdown, delivery time and link.
Mobile rows name the sale (label / client / reference + channel) instead of the merchant's own name.
`POST /merchant/links` coerces non-string free text and an unknown `kind` instead of throwing.

### Merchant Lightning identity (2026-09-22 review)
A merchant's Lightning identity is its **settlement number** as `<dial><number>@momome.xyz`
(never the code — a code cannot receive funds). `publicMerchant()` now carries
`lightning: { address, enabled, reason }` (`core/merchantAccount.ts` `lightningIdentity`):
the address is reachable for any valid number; what a proven number + active account turn ON
is the identity behind it. Before this review nothing joined the LNURL surface to merchant
accounts: a wallet resolving a verified merchant's address saw the masked person behind the SIM
(`R***** C**`), and the resulting payment carried no `merchantId`, so a Lightning Address sale
never reached the merchant's dashboard. Now `routes/lnurl.ts` consults
`merchantBySettlementPhone` + `lightningIdentity`: an enabled merchant is shown to the payer as
the **business** (the name on its pay page), and the payment is recorded under the business
name with `merchantId` set — it lands in Recent as a "Lightning Address" sale.
`onMerchantChange` (verified / updated / suspended / reactivated / forgotten) is a hook in
`merchantAccount.ts`; `connect/identities.ts` subscribes with `syncMerchantMpi`, which keeps an
existing MPI in step (phone alias verified flag, a changed settlement number retires the old
phone + Lightning aliases and adds the new one unverified, settlement destination, display
name, suspension → identity suspended, forgotten → closed). MPI creation stays lazy.
Web + mobile dashboards gained a Lightning card: address, copy, wallet QR, "a wallet paying
this address sees: <business>" (read from the same LNURL endpoint wallets use), and a
verify CTA when off. Tests: merchant-flow (+16).

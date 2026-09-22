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

### Scan-to-pay review (2026-09-22)
`/m/<MOM-code>` (the counter poster) is now claimed by the apps: `APP_PATHS` in
`server/src/routes/applinks.ts` and the Android `intentFilters` list it beside `/pay`, and
`mobile/src/app/m/[code].tsx` redirects to the pay screen — a poster scanned with the phone
camera opens the app instead of a browser tab (golive-readiness asserts the AASA path).
Mobile scan screen: the camera mounts only while the tab is focused (battery, and returning
to the tab with the same QR in frame no longer re-pushes the pay page), a torch toggle, the
reticle turns green on a read, one notice and one analytics event per physical code, Paste
(only when the clipboard holds something — `hasStringAsync` does not trigger iOS's prompt),
`autoCapitalize="none"` so a pasted case-sensitive link code survives, and a
"denied for good" state that opens Settings instead of a button that does nothing. The field
takes a code, a link or a number. Web `/scan` got the same case fix, a Paste button and a
torch where the browser exposes the capability. A merchant code resolves straight through
`resolveMerchantByCode` (no wasted link lookup), the pay card shows the merchant's category,
its error state offers "Scan again" first, and a merchant checkout can be left through
"Not this business?" — scanning the wrong poster used to lock the Send tab to that business.

### URL / link review (2026-09-22)
**One canonical host.** The apex 308-redirects to `www`, but `index.html` and the SEO
generator hard-coded `https://momome.xyz` — every canonical, hreflang, og:url, JSON-LD @id
and sitemap entry named a URL that redirects. All of them now name `www` (the generator
normalises whatever `SITE_URL` is set to), as do the hosted-checkout URL
(`connect/intents.checkoutUrl`, which fell back to the apex), the developer-dashboard email
fallback and the OpenAPI contact links.
**Sitemap ↔ INDEXABLE.** `app/src/lib/seo.ts` marked /developers, /merchant, /ambassador,
/discover and /diaspora index,follow while the sitemap listed none of them, and /receive was
in neither. Both lists now agree.
**Share previews** exist for `/m/:code` (the counter poster — business name + its QR, "you
choose the amount") and `/p/:id` (a Connect hosted checkout — payee, amount, purpose, and
"Paid" once settled), with crawler-UA rewrites in `app/vercel.json` beside /send and
/pay/:code. The stub forwards a human with a meta-refresh rather than an inline script: the
site's CSP allows no unhashed inline script and the URL differs per link, so the script was
silently doing nothing.
**CSP vs JSON-LD.** `script-src` hashed the theme and service-worker scripts but not the
JSON-LD block, so a CSP-enforcing crawler dropped the structured data. The hash is now in
the policy and `app/scripts/check-csp.mjs` fails the build if any inline script in
`dist/index.html` is not covered — a hash goes stale the moment its script changes.

### Security audit (2026-09-22) — findings and fixes
Reviewed: authentication (admin, developer, device, API credential), authorization and
cross-tenant reads, the money path (quote→payment binding, idempotency, replay), inbound and
outbound webhooks, injection (SQL/XSS), transport and CORS headers, secrets in code, logs and
git history, dependency advisories, and rate limiting.

**Fixed**
1. *A signed device request was replayable* for the whole ±5-minute clock-skew window — the
   signature covered method, path, timestamp and body, but nothing made it single-use. A
   signature on a state-changing method is now consumed ONCE PER HTTP REQUEST, in middleware
   ahead of routing (`app.ts signatureReplayGuard`) — not inside the signature check, because
   a route may legitimately ask who is calling more than once (the UPI execute path resolves
   the actor, then hands the same request to the V1 core, and that second question must not
   read as a replay of the first). GET/HEAD are exempt so client retries still work. The
   native client also signs HEDGED rather than RFC-6979 deterministic
   (`mobile/src/lib/deviceSign.ts`): a deterministic signer emits byte-identical signatures
   for two requests sharing a method, path, body and millisecond, which the server cannot
   tell apart from a replay. WebCrypto (the web client) was already random-k.
2. *Webhook SSRF.* `validCallbackUrl` refused literal private IPs but not a public hostname
   RESOLVING to one (169.254.169.254, 10/8, ::1 …), and delivery followed redirects straight
   past the check. Delivery now resolves the host on every attempt and refuses private
   addresses (`isPrivateAddress`), and uses `redirect: "manual"`. Sandbox loopback receivers
   stay allowed exactly where `validCallbackUrl` already allowed them.
3. *An admin password change left other sessions alive* for the rest of the 12-hour token
   life — the one action an operator takes when a token or laptop is compromised. Tokens now
   carry the password generation they were issued under (`pwVersion`), the guard refuses a
   stale one, and the operator making the change is handed a fresh token so they are not
   signed out by their own action.
4. *The wrong-recipient interlock token had a hard-coded fallback secret* (`"mm-risk"`) when
   `ADMIN_SESSION_SECRET` was unset, so its acknowledgement was forgeable on such a
   deployment. It now uses the server's persisted signing secret.
5. *CORS allowed `localhost` on a live-money deployment*; now only where no real money moves.
6. *`POST /momo/transfers/resolve` was unauthenticated and unthrottled* — a free oracle for
   probing which addresses route. Durable rate limit added.

**Checked, no gap found:** SQL is fully parameterised; no `dangerouslySetInnerHTML`/`innerHTML`
anywhere; `/v1` objects are cross-org guarded on every read; payment amounts are bound to a
server-issued quote claimed atomically; login, OTP, elevate and resolve are throttled durably
(per IP and per subject); rail webhooks verify signature/IP with constant-time compares; admin
role and deletion take effect immediately (the guard re-reads the user); no stack traces or
secrets reach clients; no secret has ever been committed (full-history scan); `pnpm audit`
reports no known vulnerabilities; the live deployment sends HSTS, nosniff, DENY, no-referrer
and a deny-all CSP, and boots fail-closed on a default admin password, an unkeyed compliance
chain or a world-triggerable cron.

**Left deliberately:** unsigned device ids are still accepted as bearer credentials until
`LEGACY_SENDER_UNTIL` (2026-11-01) — closing it early would lock out installs that have not
yet enrolled a key.

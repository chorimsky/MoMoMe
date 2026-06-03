# MoMo›Me

Pay Mobile Money from anywhere. To the user it's "Pay Mobile Money"; underneath it's a
settlement network that takes crypto in (Lightning / on-chain BTC / USDT-TRON), runs FX
to XAF, and pays out to MTN / Orange / Airtel across the CEMAC franc zone via PawaPay.

This repo is a **full-stack TypeScript implementation** built from the original
design-tool prototypes (preserved in [`project/`](project/)).

```
app/      Vite + React + TypeScript frontend  (@momome/app)
server/   Express + TypeScript settlement engine  (@momome/server)
shared/   Domain types + constants shared by both (the API contract)
project/  Original HTML/CSS/JSX design prototypes (visual source of truth)
BACKEND_DESIGN.md   The settlement architecture this backend implements
```

## Run it

```bash
pnpm install
pnpm dev            # runs the API (:4000) and the app (:5173) together
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api` → `:4000`.

Run them separately if you prefer: `pnpm dev:server` and `pnpm dev:app`.
Build for production: `pnpm build`. Typecheck everything: `pnpm typecheck`.

## Routes

| Route | Surface |
|-------|---------|
| `/` | Marketing landing |
| `/send` | The pay app — send flow, Activity, Help (EN/FR) |
| `/admin` | Partner/admin console — overview, payments, customers, rails, settings |
| `/ops` | Live operations dashboard (polls every 2s) |
| `/terms` `/privacy` `/contact` | Legal & contact |

## How it works end-to-end

The send flow is wired to the real settlement engine:

1. **Resolve** the recipient name from the number (`/api/recipients/resolve`).
2. **Quote** — `/api/quotes` prices the inbound crypto with a per-rail FX spread
   (Lightning/USDT tight, on-chain wider for the confirmation-window exposure).
3. **Create payment** — `/api/payments` returns a real, scannable pay instruction
   (BOLT11-shaped invoice / on-chain address / TRC20 address) rendered as an actual QR.
4. **Confirm** — `/api/payments/:id/confirm` drives the **payment state machine**
   (`AWAITING_INBOUND → INBOUND_CONFIRMED → FX_LOCKED → PAYOUT_REQUESTED → DELIVERED`),
   writing **balanced double-entry ledger** entries and paying out **exactly once**
   (idempotent on the payment ref). The UI polls `/api/payments/:id` to render progress.

See [`server/src/core/`](server/src/core/) for the ledger, FX engine, and state machine,
and [`BACKEND_DESIGN.md`](BACKEND_DESIGN.md) for the architecture rationale.

## What's real vs. simulated

The orchestration is real: the FX quote/spread/expiry logic, the double-entry ledger
(every transaction balances per currency or it throws), the payment state machine, and
the exactly-once idempotent payout contract.

The **external integrations are adapters behind a clean seam**, selected by
`RAILS_MODE` (default `sandbox` — zero credentials):

- [`server/src/adapters/sandbox.ts`](server/src/adapters/sandbox.ts) — default; generates well-formed, unique pay instructions, settled via the `/confirm` tap
- [`server/src/adapters/ibex.ts`](server/src/adapters/ibex.ts) — **live** IBEX: Lightning + on-chain BTC (token auth, `add-invoice`, address generation, HMAC-verified webhooks)
- [`server/src/adapters/tron.ts`](server/src/adapters/tron.ts) — **live** TRON: USDT/TRC20 only — a *separate* rail (IBEX does not settle USDT)
- [`server/src/adapters/pawapay.ts`](server/src/adapters/pawapay.ts) — PawaPay payout (enforces real idempotency)
- [`server/src/core/nameResolver.ts`](server/src/core/nameResolver.ts) — provider name lookup

**Going live:** copy `server/.env.example`, set `RAILS_MODE=live` + the IBEX/TRON
credentials, and inbound confirmation switches from the user tap to **signed provider
webhooks** (`POST /webhooks/ibex`, `POST /webhooks/tron`) that drive the same state
machine. The FX lock, ledger, and exactly-once payout are untouched. Data is in-memory
(seeded on boot); the store is a repository seam ready for SQLite/Postgres.

## Try the demo number

On `/send`, the prefilled number `6 70 12 34 56` resolves to a verified recipient.
Tap through to the Pay step, hit **"I've sent the payment"**, and watch the state machine
deliver it. Numbers ending in `8`/`9` come back unverified (manual-name path); ending in
`7` resolve as a returning recipient.

---

_Original design handoff note (from claude.ai/design) is preserved in [`project/`](project/);
the prototypes there remain the visual source of truth._

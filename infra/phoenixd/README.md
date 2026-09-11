# phoenixd — MoMo›Me's own Lightning node

## Why

The Lightning Address spec (LUD-06) requires the invoice a payer's wallet receives to carry
`h = sha256(metadata)`. IBEX's invoice endpoint cannot set it (probed 2026-09-11, every
parameter name), so strict wallets — Phoenix, anything on the Breez SDK — refuse to pay
`<number>@momome.xyz`. Rather than wait on a provider, MoMo›Me runs its own node for this.
phoenixd is ACINQ's self-custodial daemon: our keys, automatic inbound liquidity bought from
ACINQ's LSP, a tiny HTTP API. The server treats it as a rail (`server/src/adapters/phoenixd.ts`):

- **first choice for Lightning-Address invoices** (it can set `descriptionHash`);
- **failover for in-app Lightning** when IBEX is down;
- **an outbound rail** for Lightning refunds.

IBEX stays the primary rail for everything else. Nothing else in the codebase knows which
node minted an invoice.

## Deploy on Railway (one-time)

1. **New service** in the `momome` project → *Deploy from Dockerfile* → root `infra/phoenixd`.
   Name it `phoenixd`.
2. **Volume**: attach one, mount path `/phoenix`. This holds the seed. Back it up
   (`/phoenix/seed.dat`) somewhere safe the first time the service boots — it is the money.
3. **Variables on the phoenixd service** (generate long random values yourself; never paste
   them in chat):
   - `PHOENIXD_HTTP_PASSWORD`
   - `PHOENIXD_WEBHOOK_SECRET`
   - `PHOENIXD_WEBHOOK_URL` = `https://momome-api-production.up.railway.app/webhooks/phoenixd`
   - `PHOENIXD_CHAIN` = `mainnet`
4. **Private networking**: enable it on the project; the node is then reachable from
   momome-api as `http://phoenixd.railway.internal:9740`. Do not add a public domain.
5. **Variables on momome-api**:
   - `PHOENIXD_URL` = `http://phoenixd.railway.internal:9740`
   - `PHOENIXD_PASSWORD` = the same value as `PHOENIXD_HTTP_PASSWORD`
   - `PHOENIXD_WEBHOOK_SECRET` = the same value as on the node
   - `PHOENIXD_CHAIN` = `mainnet`
   Redeploy momome-api. Admin → Rails shows `phoenixd` configured, with its balance.

## Liquidity and cost

phoenixd has no channel until the first payment arrives. On that first receive it buys
inbound liquidity from the LSP automatically (`--auto-liquidity 2m` = a 2 M sat channel):
the mining fee plus ~1% of the purchased amount is deducted from what is received. Later
payments inside that capacity cost nothing to receive. Keep the treasury sweep in mind:
sats received on this node sit ON this node; Admin → Treasury sweeps them out
(`/payinvoice` / on-chain) when the balance is worth moving.

A first-time deposit to open the channel therefore looks "short" by the liquidity fee.
Settlement uses the amount the node actually received, so that difference is visible on
the payment as Quoted → Delivered, never silently lost.

## Verify

```bash
curl -s -u :$PHOENIXD_HTTP_PASSWORD http://phoenixd.railway.internal:9740/getinfo
```

from a shell inside the project (`railway ssh` on momome-api, or `railway run`), then pay
`237<number>@momome.xyz` from Phoenix: the invoice now carries `h`, and the wallet shows
the registered name before "Pay".

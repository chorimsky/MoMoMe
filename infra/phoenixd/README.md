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

## Starting with NO reserve — how the first payments behave

Nothing has to be deposited to make the node active. phoenixd buys its inbound channel out
of the first Lightning payment it receives, with no on-chain funds of ours involved:

| First receive is… | What phoenixd does | What MoMo›Me does |
|---|---|---|
| Large enough to cover the liquidity fee (≳ 30 000 sat, about 20 USD) | Opens a 2 M sat channel and keeps the fee (mining + ~1%) from that payment | Delivers the FULL quoted Mobile Money; books the fee as `rail_fees` (visible on the payment: "absorbed by MoMo›Me, not the customer") |
| Smaller than that | Accepts it as **fee credit**: the sats count toward the future channel and are not yet spendable | Delivers the full quoted Mobile Money; the credit shows in Admin → Rails (`feeCreditSat`) |

Fee credit is not lost money: it is spent on the channel the moment enough has accumulated
(or a larger payment arrives). Until then it is a small float MoMo›Me has paid out in XAF
against sats it cannot yet move — at the sizes involved (tens of dollars), that is a
bookkeeping fact, not a risk.

After the channel exists, receives within capacity cost nothing. Sweeping sats OUT (Admin →
Treasury) frees inbound capacity, so one channel serves indefinitely if the balance is
swept regularly. Only an unswept node that receives more than 2 M sats buys a second
channel, at the same fee.

Steady-state cost, swept weekly: effectively zero per payment. Worst case, never swept:
about 1% of volume.

## Efficiency notes

- Invoices are minted in one local HTTP call to the node; no OAuth, no provider queue.
- Settlement is confirmed by one local status read; the webhook only triggers it.
- Lightning Address payers see the registered name before "Pay" (LUD-06 metadata), and the
  invoice carries the matching description hash, so every wallet — strict or lenient — pays.
- IBEX remains the primary rail for in-app Lightning, on-chain BTC and stablecoins; this
  node is the first choice only where the description hash is required, and a failover
  otherwise. An outage on either side degrades to the other, never to a dead end.

## Verify

```bash
curl -s -u :$PHOENIXD_HTTP_PASSWORD http://phoenixd.railway.internal:9740/getinfo
```

from a shell inside the project (`railway ssh` on momome-api, or `railway run`), then pay
`237<number>@momome.xyz` from Phoenix: the invoice now carries `h`, and the wallet shows
the registered name before "Pay".

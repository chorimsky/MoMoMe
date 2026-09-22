# Integration map

| Provider | Role | Adapter | Exposed publicly? |
|---|---|---|---|
| IBEX Hub | Lightning receive/send, on-chain BTC, ERC-20 USDT/USDC deposits, balances | `adapters/ibex.ts` behind `RailAdapter` | never (assets/networks only) |
| phoenixd | own Lightning node (LUD-06 description_hash) | `adapters/phoenixd.ts` | never |
| Peexit | XAF payouts (MTN/Orange), Get-KYC names, collections | `adapters/peexit.ts` (`PayoutAdapter`), `identityResolution/providers/peexit_verify` | never |
| PawaPay | XAF payouts (multi-market), deposits | `adapters/pawapay.ts` | never |
| MTN Open API | names (creds operator-owned) | `identityResolution/providers/mtn_direct` | never |
| Coinbase/Kraken | FX feeds | `core/rates.ts` | never |
| WhatsApp / SMS / push | notifications | `adapters/notify.ts`, `whatsapp.ts` | n/a |
| Resend-compatible email | developer emails | `core/platform/email.ts` | n/a |
| Sentry, Railway, Vercel, EAS | ops | scripts | n/a |

Connect keeps every provider behind its adapter; the new Lightning service (`core/connect/lightning.ts`)
is a façade over `adapters/index.ts` (`outboundRail().payInvoice`, `createInstruction`) so a second
Lightning provider or an LSP is a new adapter, not an API change.

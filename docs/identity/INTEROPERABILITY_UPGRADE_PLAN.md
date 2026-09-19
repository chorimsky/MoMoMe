# Interoperability Upgrade Plan — where identity resolution fits

The network layer (docs/interop-v2) moves money MoMo → Lightning → MoMo across markets. Identity resolution is the step **before** an intent: know the destination account exists and to whom it belongs.

| phase | status | identity dependency |
|---|---|---|
| Interop v2 network (markets, FX, rails, saga, canary) | built, flags off | none |
| Recipient identity — Cameroon (MTN direct) | built, flag off | MTN credentials (operator) |
| Recipient identity — Orange CM | stub | Orange identity contract |
| Cross-market identity (KE, GH, NG, …) | normalisation supports every `MARKETS` country; no authoritative provider yet | per-market provider (MTN Open API in MTN markets; Safaricom Daraja lacks a name lookup → aggregator hint only) |
| `NetworkIntent.recipientIdentity` | type in place, attached only when a cached answer exists | same cache as V1 |
| Gate mode on network intents | not wired (advisory only) | after one advisory cycle |

Rule kept from the network layer: everything additive, every surface behind its own flag, activation by variables not deploys.

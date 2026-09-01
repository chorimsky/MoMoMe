# MoMo›Me — review fixes, apply order

Patches for the findings in `MoMoMe Code Review`. Each is written against the code as
read on 14 Aug 2026. Apply in this order — F2/F3 first, they're the only ones where the
failure mode is a stranger reading someone's payments.

| # | File | Change | Risk | Needs a decision |
|---|------|--------|------|------------------|
| F3 | `server/src/routes/api.ts` | Ownership check denies by default | low | no |
| F2 | `server/src/routes/api.ts` | Close the legacy device-auth door | low | cut-over date |
| F6 | `server/src/core/ratelimit.ts` + `routes/api.ts` | Durable limits on money routes | low | no |
| F4 | `server/src/core/publicRates.ts` + `core/rates.ts` | Two-source FX with divergence guard | medium | band width |
| F5 | `shared/domain.ts` + `server/src/core/stateMachine.ts` | Float from aggregator balance | medium | floor value |
| F1 | `server/src/core/stateMachine.ts` | Re-price on-chain at confirmation | **high** | **yes — see below** |
| F11 | `package.json` | Root test script, drop stray dep | none | no |
| F12 | `.gitignore` + deletions | Build residue | none | which db is real |

`F7`–`F10` (route split, design-system adoption, CSS scoping, `project/` demotion) are
refactors, not patches — they're described at the end rather than diffed, because a
mechanical diff of a 1,936-line file split is more dangerous than doing it by hand.

---

## F1 needs your call before you apply it

The on-chain quote currently says "estimate" to the user and books a lock in the ledger.
Two coherent ways out; the patch implements the first, which is what `BACKEND_DESIGN` §3
recommends for v1:

**A — Re-price on confirmation (patched).** At `INBOUND_CONFIRMED`, recompute XAF from
the amount actually received at the current rate, then book that. The user's disclaimer
becomes true. The sender carries the price move. Requires fresh rates at confirmation
time — the patch holds for review rather than silently honouring a stale lock.

**B — Honour the lock and price for it.** Drop the estimate language, widen
`RAIL_SPREAD_BPS.ONCHAIN` to cover a real 60-minute window, and accept the exposure as a
cost of business. Simpler code, worse pricing, and it only works if you can stomach the
tail.

Don't ship the current middle state either way — it's the only one where the code and
the copy disagree.

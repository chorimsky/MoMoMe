# Phase 0 — Risk register

**Date:** 2026-11-06 · **Commit:** `9e4e6e3`

Severity is about money and availability, not elegance. "Verified" means this audit
observed it directly; "unverified" means it needs access this audit did not have.

## Register

| ID | Risk | Sev | Status | Owner |
| --- | --- | --- | --- | --- |
| RISK-00 | One routable+funded payout rail, at ~49 % success | **Critical** | Verified | Operator |
| RISK-01 | Hashed assets served `max-age=0, must-revalidate` | Medium | Verified | Engineering |
| RISK-02 | Apex `momome.xyz` costs a second full connection | Low | Verified | Engineering |
| RISK-03 | A `v*` tag also fires a Hostinger deploy pointed at the old demo backend | **High** | Partly verified | Engineering |
| RISK-04 | `/api/config` 29.8 KB, `no-store`, on every boot | Low | Verified, review only | Engineering |
| RISK-05 | Single container, `numReplicas: 1`, in-memory authoritative state | **High** | Verified | Engineering |
| RISK-06 | SQLite on one volume; no verified backup/restore drill | **High** | Unverified | Operator |
| RISK-07 | No distributed tracing; no percentile latency | Medium | Verified | Engineering |
| RISK-08 | Premature regional expansion would fork the ledger | **Critical if attempted** | Verified by design | Engineering |
| RISK-09 | `node_modules` is hoisted, not isolated | Low | Verified | Engineering |
| RISK-10 | Legacy unsigned-device window expired 2026-11-01 | Medium | Verified | Operator |
| RISK-11 | DNS single-provider (Hostinger), no secondary | Low | Verified | Operator |
| RISK-12 | Data residency for CEMAC not established | **High (legal)** | Unverified | Operator + counsel |

## Detail on the ones that change a decision

### RISK-00 — the only rail that works, half-works

`/health/deep`: peexit 112 samples, **49.1 %** success, **286,134 ms** average, the only
rail with `routable: true` **and** `funded: true`. CamPay `funded: false` with the recorded
problem *"campay holds an amount, none of it on an MTN or Orange float"*; PawaPay
`routable: false`, 0 samples. `"ok": false`, `"open critical alert"`.

Routing and failover logic are built and correct; they have nowhere to fail over to.
**Mitigation is operator action, not code:** allocate the CamPay carrier float, and send
`docs/ops/PEEXIT_ORANGE_MESSAGE.md` with live `track_id`s. This outranks everything else in
this register and everything in the global-edge plan.

### RISK-03 — a release tag can deploy a second frontend at the wrong backend

`deploy-hostinger.yml` triggers on `push: tags: ["v*"]` with `VITE_API_BASE` defaulting to
`https://mo-mo-me-server.vercel.app/api` — the **old demo backend**, not Railway. The same
tag also fires `deploy.yml`. DNS currently points `www.momome.xyz` at Vercel, so a Hostinger
deploy would likely land somewhere no longer serving the domain — which is why this is
*probably* inert.

But "probably inert" is doing a lot of work in a system that moves money. The failure, if
the Hostinger host *is* still reachable at any name a user has, is a live SPA talking to a
demo backend: balances and payment states that are fiction. **Unverified** because the
Hostinger account was not accessible.

Recommended: confirm whether the Hostinger target still serves anything; if not, delete the
workflow; if it does, remove the `v*` trigger and the demo default regardless. Do not leave
a tag push able to publish a second frontend.

### RISK-05 / RISK-08 — the single process, and why not to "fix" it by going regional

`railway.json` sets `numReplicas: 1`. `core/persist.ts` keeps the authoritative working set
in process memory. `core/momoTransfer.ts` serialises settlement through an **in-process**
promise map.

Today this is coherent: one process, one writer, one lock, correct. The danger is the
*apparent* easy upgrade — raise replicas, or add a region — which would give each instance
its own balances and its own settlement lock. That is the plan's own prohibition on
*"independent regional writes creating competing authoritative account balances"*, and the
architecture would walk into it silently, with no error, producing divergent ledgers.

**Therefore RISK-08 is latent, not active — and it activates the moment someone acts on the
global-edge plan in its stated order.** Phases 3 and 4 must wait on the async call-site
rewrite that wires `server/src/db/repo.ts` (already correct, already tested in isolation)
into the app. That is the keystone task. Sequencing note: the plan's "do not introduce
complexity without evidence" and this finding agree.

### RISK-06 — the thing that would actually lose money

A single SQLite file on a single Railway volume holds the ledger. This audit could not
reach the volume, so the following are **unknown**: file size and growth, volume headroom,
whether backups run, where they go, their retention, and **whether a restore has ever been
tested**. `persist.ts` does `copyFileSync` for snapshot safety, which is not the same as an
off-host backup.

An untested restore is not a backup. Against a container that can be redeployed at any
time, this is the highest-severity item that engineering can actually act on — and it is
cheaper than any phase of the global-edge plan.

### RISK-12 — residency is a legal question, not a routing one

`docs/compliance/` records the Cameroon/CEMAC map: Règlement 02/24, ANIF STR obligations,
BEAC Instruction 002/2026, the COBAC crypto position. The compliance engine with
hash-chained tamper-evident records is built.

What is **not** established is where regulated customer and transaction data may lawfully be
stored, replicated or processed. The service currently runs from one region (observed
`fra1` for the CDN; Railway region unknown — itself a residency finding). Any replica in
any new jurisdiction is a legal act before it is a technical one. The plan is right that
*"geographic routing or encryption alone"* does not establish compliance. This needs counsel,
before any replica is created.

## Approval gates — actions this audit will not take without explicit authorisation

Per the plan's Phase 6 and this project's standing rules:

- Changing production DNS
- Creating production database replicas, or promoting one
- Moving regulated data across jurisdictions
- Rotating production secrets
- Destructive migrations
- Changing payment authorisation or settlement routing
- Raising `numReplicas` above 1 (RISK-05/08)
- Incurring new cloud cost in any provider
- Deleting `deploy-hostinger.yml` or any component classified "review before removal"

## Recommended order, on this evidence

1. **RISK-00** — CamPay float, Peexit Orange message. Operator. Outranks all engineering.
2. **RISK-06** — prove a restore. Highest-severity item engineering can act on.
3. **RISK-03** — close the tag-triggered second frontend.
4. **RISK-01**, then **RISK-02** — measured, cheap, reversible, real round trips removed.
5. **RISK-07** — percentiles and tracing, so Phase 1 can ever be satisfied honestly.
6. **The async rewire** — the precondition for Phases 3–4.
7. **Regional work** — only after 5 and 6, and only if the numbers from 5 justify it.

Note what this ordering does: it puts four items that cost almost nothing, plus one legal
question, ahead of the entire multi-region programme — because none of the regional work
can be justified, or even safely built, until they are done.

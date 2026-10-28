# Phase 0 — Verified current state, against the Master Blueprint

**Date:** 2026-10-24 · **Commit audited:** `efd7f80` on `main` · **Method:** read of the
repository as it stands, not of its documentation. Every claim below names the file that
supports it. Nothing here was implemented for this audit; the blueprint says not to.

## 0. What this is, and what it is not

This answers one question: *of the architecture the blueprint describes, what already
exists, what exists but is dark, and what does not exist at all.* It is a map, not a plan.
The gap register in §3 is ordered, but no ordering survives contact with a commercial
decision — several gaps are blocked on provider agreements, not on engineering.

**Not verified here, and deliberately so:**

- **Production behaviour.** This reads `main`. Production is on `781970c` — **10 commits
  behind**, including the send-flow method fix and today's settlement fix. Any statement
  below is about the code, not about what is serving traffic. That divergence is itself a
  finding (§3.11).
- **Provider truth.** What MTN, Orange, CamPay, Peexit or PawaPay actually do under load is
  known only where there is a credential and a sandbox. Where there is neither, the adapter
  encodes a reading of a document (`docs/campay/`, `docs/peexit/`, `docs/payfonte/`).
- **Numerical performance.** No latency target is asserted. The blueprint is right that the
  audit must establish actuals first, and the instrumentation for that is partial (§3.7).

## 1. The system as built

| Area | Files | Lines |
| --- | --- | --- |
| `server/src` | 199 | 31,923 |
| `app/src` | 117 | 23,842 |
| `shared` | 11 | 3,833 |

One gate, one chain: `pnpm check` = typecheck (server + mobile) + **104 test suites /
2,984 assertions**, green at `efd7f80`.

### 1.1 Blueprint §9 — endpoint / rail / route / settlement

**Separated, in the layer that is switched off.** The live V1 `Payment`
(`shared/types.ts:87`) carries `method`, `recipient.provider` and `aggregator` as flat
fields: funding rail, destination network and executing provider in three unrelated
strings. The blueprint's four-way separation exists properly in
`server/src/core/upi/` — `identity.ts` (endpoint), `rails.ts` (funding), `routing.ts`
(route), `ledger.ts` (settlement refs) — behind flags that are **all off by default**
(`server/src/core/upi/flags.ts`), with `ROUTING_ENGINE_MODE` defaulting to `SHADOW`.

So §9 is not a gap to design. It is a migration to finish.

### 1.2 Blueprint §10, §12 — lifecycle and state machine

Two lifecycles coexist:

- **V1, which carries real money** — 12 states, `QUOTED → AWAITING_INBOUND →
  INBOUND_DETECTED → INBOUND_CONFIRMED → FX_LOCKED → PAYOUT_REQUESTED → PAYOUT_CONFIRMED →
  DELIVERED`, plus `REFUND_PENDING`, `REFUNDED`, `FAILED`, `MANUAL_REVIEW`
  (`shared/types.ts:87`), driven by `server/src/core/stateMachine.ts` (1,443 lines).
- **Intent v2, dark** — the blueprint's own ladder, near enough verbatim: `CREATED →
  IDENTITY_RESOLVED → QUOTED → ROUTE_SELECTED → LIQUIDITY_RESERVED → PAYMENT_PENDING →
  PAYMENT_DETECTED → PAYMENT_CONFIRMED → SETTLEMENT_* → COMPLETED`
  (`server/src/core/upi/intents.ts`). It does not re-implement the money legs; an executed
  intent hands the leg to V1 and mirrors its state.

The lifecycle's substance is in place: a quote is claimed atomically so a locked rate
becomes exactly one payment; a payout is gated pre-flight so no inbound address is ever
minted for a payment that cannot land (`server/src/routes/api.ts`, six refusals); a
provider callback is a **hint** and never a verdict — settlement is always an authoritative
re-query (`server/src/routes/webhooks.ts:77`).

**The gap is structural, not behavioural** (§3.1): `transition()`
(`server/src/core/stateMachine.ts:366`) writes whatever state it is handed. There is no
legal-transition table anywhere in the tree — `LEGAL`, `ALLOWED_TRANSITIONS`,
`canTransition` return nothing. Correctness lives in ~40 call-site guards of the form
`if (p.state !== "PAYOUT_REQUESTED") return`. They are good guards, and they are the
reason the system is correct today. They are also unenumerable, which is what the
blueprint's "defined triggering event / validation rule / evidence requirement" asks to fix.

### 1.3 Blueprint §13–§16 — human and machine interfaces

One capability set, several front doors, and they genuinely share the engine:

- **Public developer API** — `server/src/publicApi/` + `/v1`, with orgs, credentials,
  idempotency, typed errors, webhooks, settlements, limits, reservations, OpenAPI and SDKs
  (`sdk/`). Tenant isolation is enforced per read, not assumed
  (`server/src/publicApi/payments.ts:38`).
- **Connect** — `server/src/core/connect/`: MPI identities, canonical intents, invoices,
  links, QR, request-to-pay, hosted checkout.
- **Device clients** — P-256 signed requests (`x-mm-sender` / `x-mm-ts` / `x-mm-sig`).
- **Conversational** — WhatsApp bot (`server/src/core/whatsappBot.ts`).

Machine identity exists at **org → app → credential** with scopes, IP allow-list, rotation
with grace, revocation and live/test separation (`server/src/core/platform/credentials.ts`).
What does not exist is anything below that: see §3.2 and §3.3.

### 1.4 Blueprint §18–§20 — intelligence

The discipline the blueprint asks for is already demonstrated, in one domain. The Capital
Copilot (`server/src/core/capital/copilot.ts`) computes every number in a deterministic
engine and lets the model **only phrase** what the engine produced; the answer carries
metrics, assumptions, sources, calculation refs, confidence and data freshness; every
exchange is written to an AI audit log; and the copilot cannot execute anything — at most it
points at a recommendation that still needs one person to review and another to approve.

That is the §18 contract, implemented. It is also the *only* instance of it: intent
recognition is a regex table over capital questions. The other ten capabilities in §20 have
no shared retrieval or permission layer (§3.6).

Deterministic intelligence, by contrast, is broad: rail health with 3-strikes failover and
probe cooldown (`server/src/core/railHealth.ts`), cost-first funded routing
(`server/src/core/routing.ts`), float planning, alert conditions with paging
(`server/src/core/alerts.ts`), Sentry (`errorSink.ts`), p50/p95/p99 per route class
(`interop/metrics.ts`), and the "why payments fail" report.

### 1.5 Blueprint §21–§23 — events

Four stores, no bus. Payment history on the row (`p.events`), provider callbacks with
payload hashes and duplicate detection (`interop/events.ts`), per-org platform audit capped
at 5,000 (`platform/audit.ts`), and the hash-chained compliance chain (`core/compliance.ts`)
— the only tamper-evident one. No queue dependency exists in the tree. See §3.5.

### 1.6 Blueprint §28–§30 — security and compliance

Present and tested: egress allow-list with a proxy service, admin step-up, HMAC admin
tokens, webhook signature verification per rail (and **fail-closed** where a signature
cannot be checked — PawaPay v2 callbacks are rejected and settlement falls back to polling),
per-credential IP allow-list, CEMAC compliance engine with STR/CTR and an append-only chain,
`regulatory.ts` policy map, identity resolution with a gate mode.

The AI boundary the blueprint demands in §28 holds today for the reason that the only AI with
any reach is the copilot, and it cannot execute. That is a property of the current scope,
not of an enforced boundary — which is what makes §3.2 load-bearing before Phase 6.

### 1.7 Blueprint §31–§36 — operations and resilience

Strongest area, because it was built from incidents. Unknown is never zero: an unreadable
balance is `null` and reported as unknown, never as empty (`routing.ts`, with per-rail
reasons); a float nobody could read falls back rather than blocking; `successRate()` at zero
samples is documented rather than implied. Recovery distinguishes *failed* from *unknown*:
every failover re-queries the abandoned attempt authoritatively before a new key is issued,
and `PENDING` stops the failover dead (`stateMachine.ts:442`). Reconcile backstops exist for
stuck payouts, inbounds, refunds and stalled settlements. ISO 20022 is implemented against
the standard with a bank simulator as conformance harness (`core/iso20022/`), with no live
counterparty yet.

## 2. The twelve invariants (§6)

| # | Invariant | State | Evidence |
| --- | --- | --- | --- |
| 1 | Working functionality not discarded | **Held** | Every layer (UPI, interop, connect, capital) is additive and flag-gated |
| 2 | Traceable lifecycle | **Held** | `p.events` + provider events + audit |
| 3 | Accountable actor | **Held** | `senderId` required at creation; ownerless payment refused (`api.ts`), `mayViewPayment` denies by default |
| 4 | Authorization independent of AI | **Held, by scope** | The only AI cannot execute (§1.4); no enforced boundary yet (§3.2) |
| 5 | Outcomes from authoritative evidence | **Held** | Callback → re-query, never callback → settle |
| 6 | Controlled integration boundary | **Held** | Four adapter registries + egress allow-list |
| 7 | Uncertain states stay uncertain | **Held** | `PENDING` blocks failover; unknown ≠ zero throughout |
| 8 | Idempotent, provider-aware retries | **Held** | `payoutKeyOf`, per-attempt keys, `NO_RETRY_PAYOUT_FAIL` vs `HARD_PAYOUT_FAIL` |
| 9 | Auditable financial change | **Partial** | Four stores, one retention policy each, one chain (§3.5) |
| 10 | Intelligence within boundaries | **Partial** | True for the copilot; no general policy (§3.6) |
| 11 | Safe without AI | **Held** | No AI on the money path; `metaAiConfigured()` is optional everywhere |
| 12 | Measurable, reversible, incremental | **Held** | Flags off by default, documented rollback (`docs/upi/ROLLBACK_PLAN.md`), one gate |

Nine held, three partial, none violated. The partials are all in the blueprint's later
phases, which is the right place for them to be.

## 3. Gap register

Each gap: what is missing, how it was verified, what it costs, and whether it is reversible.

### 3.1 No declarative transition table — *Phase 1, highest value*
**Verified:** no `LEGAL`/`ALLOWED_TRANSITIONS`/`canTransition` in `server/src`;
`transition()` performs no legality check.
**Cost:** a transition that no call site guards is admitted silently. This is not
hypothetical — the bug fixed in `efd7f80` was exactly that: a verdict on a superseded payout
attempt was admitted because the one guard that existed was asymmetric, and it would have
refunded money another rail was still carrying.
**Change:** a table of `from → to` with, per edge, the trigger, the evidence required and
the duplicate/out-of-order response; `transition()` refuses an edge not in it; one test
enumerates every edge. Additive and reversible (log-only first, then enforce).

### 3.2 No agent principal, no delegation — *blocks Phase 6*
**Verified:** zero hits for `agentId`, `delegation`, `delegated` or "AI agent" in
`server/src`. No MCP or agent-tool surface.
**Cost:** §15 ("an agent must not be able to expand its own permissions") cannot be stated,
let alone enforced, because there is no agent to constrain. Today an agent would hold an
ordinary credential with full org authority.
**Change:** a principal type below credential, with its own authority record. Do not build
it before 3.3, or the authority record will have nothing to say.

### 3.3 Delegated authority is money-only and org-scoped
**Verified:** `platform/limits.ts` — `LimitRule.ceilings` is
`{max,min}TransactionXaf`, `daily/monthlyXaf`, `velocityPerHour`, `dailyCount`; scope is
org/env/country/asset/currency/operator/plan. Approval threshold is **global**
(`settings.ops.payoutApprovalXaf`), not per delegation.
**Missing from §15:** approved-recipient allow-list, merchant categories, permitted funding
methods, permitted jurisdictions as an allow-list, validity period, prohibited operations,
per-delegation approval threshold.
**Cost:** a machine can be told *how much*, never *to whom* or *for what*.
**Change:** extend the rule with allow-lists and a validity window; keep ceilings as they
are. Reversible: an absent allow-list means "no constraint", so existing rules behave
identically.

### 3.4 Credentials never expire
**Verified:** `Credential` has `createdAt`/`revokedAt`/`lastUsedAt` — no `expiresAt`.
**Cost:** §14 asks for short-lived tokens or workload identity; what exists is a permanent
bearer secret with good hygiene around it (rotation with grace, IP allow-list, scopes).
**Change:** optional `expiresAt` + a near-expiry warning. Low risk; set nothing and nothing
changes.

### 3.5 No event bus, no replay, no dead-letter, no schema version
**Verified:** four separate stores (§1.5); no queue dependency.
**Cost:** §22's named concerns — replay, DLQ, schema evolution, retention — have no single
place to be addressed. Duplicate delivery *is* handled (payload-hash dedupe + idempotent
consumers), which is the part that protects money.
**Change:** a typed event record with a version, written once and fanned out to the existing
stores, before any new consumer is added. Sequencing matters: build this before §3.6, or
each intelligence capability invents its own feed.

### 3.6 Intelligence is one domain deep
**Verified:** `copilot.ask` routes a regex intent table over capital engine calls only.
**Cost:** §20's other capabilities (transaction, operations, provider, fraud, compliance,
liquidity, customer, partner, security, developer) have no shared grounding or permission
layer. The pattern to copy already exists and is good; nothing generalises it.
**Change:** lift the copilot's contract — engine computes, model phrases, every claim cites
evidence, audit every exchange — into a shared service with per-capability data scopes.
Depends on §3.5.

### 3.7 Per-stage latency is unmeasured
**Verified:** measured today — HTTP route class p50/95/99, provider call latency, identity
provider latency, payout `PAYOUT_REQUESTED`→confirmation. Not measured — quote generation,
authorization, end-to-end payment, queue delay, webhook delivery delay.
**Cost:** §35 says establish actuals before setting targets. Half the stages cannot produce
an actual.
**Change:** stamp the stages on the payment and derive the rest from events. Additive.

### 3.8 V1 is the flat model and V1 carries the money
**Verified:** §1.1. **Cost:** every §9 benefit is in a layer that is off. **Change:** finish
the migration corridor by corridor behind the existing canary controls — this is the one gap
whose work is already designed and partly built.

### 3.9 ISO 20022 has no counterparty
**Verified:** `core/iso20022/` + `adapters/deferred.ts` are complete against the standard
and tested against the simulator; no bank, MFI or switch is connected.
**Cost:** none technically. It is a commercial gap, and the blueprint is explicit that
expansion is gated on agreements.

### 3.10 Sandbox completes synchronously — *overstated when first written*
**Corrected 2026-10-24.** A closer read says the §16 contract IS met: `POST
/v1/sandbox/payments/:id/pay` backgrounds the settle and replies with the payment still
`AWAITING_PAYMENT`, so an integrator cannot learn the outcome without polling or
subscribing. The original wording implied the API conflated acceptance with completion. It
does not.

What remains is narrower and real: the default simulated rail settles in about a second, so
an integrator who never tries the `PAYMENT_DELAYED` number can poll once, see `COMPLETED`,
and ship code that assumes a payment finishes inside the request — when in production the
payer's own wait is minutes. The sandbox misleads about **timing**, not about the contract.

Fixed by being explicit rather than by making every rehearsal artificially slow: the pay
reply now says "accepted, not settled", tells the caller to poll or subscribe, and names the
number that rehearses a slow rail. A deliberate default delay was considered and rejected —
it would slow every integrator's test suite to protect the ones who do not read.

### 3.11 Production is 10 commits behind `main`
**Verified:** last deployed `781970c`; `main` at `efd7f80`.
**Cost:** this audit describes code that is not serving traffic, and the undeployed set
includes two money-path fixes. Nothing in Phase 1 should start before the deploy, or Phase 1
will be reasoning about the wrong system.

## 3b. What has been done since this audit was written

The audit is left as it was written, because an audit that quietly edits itself to match the
work is no longer evidence. This section records what moved.

| Gap | State | Commit |
| --- | --- | --- |
| **Live send review, 2026-10-28** | The deployed flow was driven end to end against production. It behaves correctly: with no funded payout rail, all four methods read "Not available right now · no funded payout rail", **Continue is disabled**, and the banner says nothing has been charged. `f57a6fd` is confirmed in production — the verification that had been outstanding since the 24th. What the review actually found is **operational**: production cannot pay out to MTN at all (peexit's API host NXDOMAIN since the 24th; pawapay funded but out of rotation for CMR; campay integrated and never configured), and recipient verification is down with it, so senders type the name by hand. Neither is a code defect. | — |
| 3.11 production behind `main` | **Deployed** `88e4e10`. The health gate FAILED on `collection rail down: peexit` — the vendor outage, not the build; a provider-reachability check that the previous build would fail identically right now. Not rolled back: reverting removes two money-path fixes and does not make Peexit reachable. | — |
| 3.1 no transition table | **Done, log-only.** `TRANSITION_TABLE_ENFORCE` off. The log-only phase earned itself on its first full-suite run: two edges the table denied and the engine really takes (`FX_LOCKED→FX_LOCKED`, a re-price; `FAILED→INBOUND_CONFIRMED`, an expired invoice paid late — the recovery for September's largest failure class). Enforcing on day one would have broken both. | `2e6cfe4` |
| 3.3 delegation money-only | **Done.** `allow` (recipients, destination operators, countries, funding methods), `scope.credentialIds`, `notBefore`/`notAfter`, `requireApprovalAboveXaf` stamped on the payment and applied as the lower of it and the global threshold. Absent list = no constraint, so existing rules are unchanged. | below |
| 3.5 no event spine | **Done, first producers.** `core/journal.ts`: versioned envelope, registered sinks, never throws, undeclared types kept and flagged. Producers: every transition, and every undeclared edge. Not a queue; partner delivery keeps its own retry/DLQ/replay. | below |
| 3.4 credentials never expire | **Done.** Optional `expiresAt` (`expires_in_days`, capped at 730), `401 credential_expired` distinct from revoked, rotation renews the lifetime rather than the remainder. Absent = permanent, so nothing deployed stops working. | below |
| 3.7 per-stage latency unmeasured | **Done, derived.** `core/stageLatency.ts` computes p50/p95/p99 for seven stages from the transition timestamps already on the payments — no new writes on the money path, and retrospective over existing history. Percentiles withheld below 5 samples; a payment still in a stage is excluded from it. On `GET /api/admin/reports`. | below |
| 3.2 no agent principal | **Partly done: the fail-closed half.** `kind: "agent"` is declarable (its own endpoint, preserved across rotation), and an agent with no delegation in force cannot create LIVE payments. It is a restriction only — no autonomy was granted, so it does not presume an answer to §5.4. What is still not built is anything that lets an agent act on its own: no agent-tool surface, no MCP, no machine-to-machine initiation. | below |
| 3.6 intelligence one domain deep | **Contract generalised, one capability built.** `shared/intelligence.ts` + `core/intelligence/contract.ts` lift the capital copilot's discipline into a shared door: claims carry the engine's numbers and their evidence, facts are labelled apart from inferences and hypotheses, scope is enforced outside the capability, every exchange is audited, and the answer exists with no model configured. The guard is the point: a model's phrasing is checked against the computed figures and **discarded** if it contains one the engine did not produce. First capability: transaction intelligence (`GET /api/admin/intelligence/payment/:ref`). Scope call made without the operator's input after repeated instruction to proceed — see §5a. | below |
| 3.10 sandbox synchronous | **Corrected, then fixed narrowly.** The original finding overstated it (the API does distinguish accepted from completed). The real residue was timing realism; the pay reply now says so and names the slow-rail rehearsal number. | below |

## 4. Recommended first slice

Not the whole of Phase 1 — the part that is unblocked, verifiable, and reversible.

1. **Deploy `main`** and confirm the send-flow method fix against the "no funded payout
   rail" condition (§3.11). Nothing else first.
2. **Transition table, log-only** (§3.1): every edge declared, violations logged, nothing
   refused. Run it for a week and read what it logs; the illegal edges it finds are the real
   state machine.
3. **Enforce it**, with the enumerating test.
4. **Delegation allow-lists** (§3.3), absent-means-unconstrained so existing behaviour is
   identical.
5. **Versioned event record** (§3.5), written once, fanned out to today's four stores.

Each step is one commit, behind the one gate, with the whole thing reversible by reverting.

## 5a. A scope call made without an answer

§3.6 was listed as needing the operator's input, because choosing which of §20's eleven
capabilities to build is choosing what their operators need to ask. After repeated
instruction to proceed, that call was made here rather than left open, and it is recorded
so it can be disagreed with cheaply:

- **Built:** the shared contract, plus **transaction intelligence** only. Chosen because it
  is the question asked first after any incident, and because its evidence already exists in
  full — the payment carries every transition, the journal carries what was refused, the
  registry carries who was asked. It needed no new collection, which also makes it the test
  of whether the event spine was worth building.
- **Not built:** the other ten capabilities in §20. Each is a registry entry plus a claims
  function against the shared contract now, not a new subsystem — which is the only part of
  this that was architecture rather than product.
- **Still the operator's:** whether any of them should be able to ACT. Nothing here can:
  the contract has no execution path at all, by construction rather than by configuration.

## 5. Questions only the operator can answer

1. **Custody.** Stablecoin settlement in the UPI layer is blocked on a custody decision, and
   it has been for a while. Until it is made, §9's digital-asset endpoints stay theoretical.
2. **Which corridor goes live first**, and is there an agreement behind it? §3.8's migration
   is sequenced by corridor, and the sequence should follow commercial reality.
3. **Is a bank, MFI or switch actually in conversation?** §3.9 is finished engineering
   waiting on a counterparty; if none is near, it should stop being treated as near-term.
4. **How much autonomy is wanted for agents, and for whose money?** §3.2 and §3.3 can be
   built to several depths. The honest answer may be "none yet", and that is a design input,
   not a delay.

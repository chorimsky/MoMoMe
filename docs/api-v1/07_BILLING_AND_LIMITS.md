# API v1 — Plans, usage, billing, limits

Plans (`core/platform/billing.ts`, admin-editable): developer (60 rpm / 15 on payments / 1.5 %),
business (300 / 60 / 1.2 % with volume tiers), enterprise (1200 / 300 / negotiated). The quote engine takes
the organization's effective fee through `effectiveFeePct(org, env)` (tiers by this month's live volume).
Usage (`core/platform/usage.ts`): per org × env × UTC day — requests by class, errors, latency, quotes,
payments, completed, failed, volume, fees, webhooks, settlements. Invoices are built from usage per month
(draft → issued → paid) from Admin → Platform; a correction is a new credit-note invoice, never an edit.
Limits (`core/platform/limits.ts`): rules with scope (org/credential/env/country/asset/currency/operator/plan),
ceilings (min/max per transaction, daily, monthly, velocity per hour, daily count) and — new — a
**delegation**. Two defaults exist (live, test); nothing country-specific is in code.

## Delegation: what a credential may do, not only how much

A rule has three independent parts, and the first two are easy to confuse:

| Part | Question it answers | Example |
| --- | --- | --- |
| `scope` | which payments this rule is **about** | `scope.operators: ["MTN"]` → "this rule has an opinion about MTN payments". It permits nothing. |
| `allow` | what a matched payment may **do** | `allow.destinationOperators: ["MTN"]` → "only MTN may be paid". |
| `ceilings` | how much | `maxTransactionXaf: 50000` |

`scope` selects the rule; `allow` restricts the payment. A rule that scopes to MTN and
allows nothing restricts nothing about MTN.

**An absent or empty `allow` list is NO CONSTRAINT**, never "deny all" — every rule written
before this existed behaves exactly as it did, and clearing a list in the console does not
lock an organization out of its own API.

```jsonc
{
  "name": "Procurement agent",
  "scope": { "orgIds": ["org_x"], "credentialIds": ["cred_agent"], "envs": ["live"] },
  "ceilings": { "maxTransactionXaf": 50000, "dailyXaf": 500000 },
  "allow": {
    "recipients": ["670123456", "677000111"],   // local digits; the country code does not defeat it
    "destinationOperators": ["MTN"],
    "destinationCountries": ["CM"],
    "fundingMethods": ["LIGHTNING"]
  },
  "notBefore": "2026-11-01T00:00:00Z",
  "notAfter": "2027-02-01T00:00:00Z",
  "requireApprovalAboveXaf": 25000
}
```

- `credentialIds` is what makes a rule a **delegation** rather than an organization-wide
  policy: one machine's key can be bounded without bounding the humans and servers that
  share its organization. A credential-scoped rule does **not** apply to a caller that did
  not identify itself — unknown is not everyone.
- `notBefore` / `notAfter`: outside the window the rule simply does not apply. That is not a
  refusal; whatever other rules match stay in charge, and the environment defaults still
  bound the organization.
- `requireApprovalAboveXaf` only ever **tightens**. The threshold that applied when the
  payment was accepted is stamped on it (`Payment.approvalAboveXaf`, like the FX spread),
  and settlement holds at the **lower** of that and the operator's global threshold. A
  caller who influenced the value can therefore only cause more of its own payments to wait
  for a person.

A delegation refusal is **`403 not_permitted`**, not `422 limit_exceeded`: the credential may
create payments and this one is not too big — it is simply not one this credential may make.
`details` names the rule and the failing check (`recipient_not_allowed`,
`operator_not_allowed`, `country_not_allowed`, `funding_method_not_allowed`). For the
recipient check only `allowed_count` is returned, never the list: that list is somebody's
phone book.

## Agent principals

A credential may declare what kind of principal holds it: `server` (the default, and what
every existing credential is) or `agent` — something that interprets instructions and can
decide to act. Declaring `agent` only ever takes authority away.

`POST /orgs/:org/credentials/:id/kind` with `{ "kind": "agent" }`. It is its own endpoint,
not a field on the credential edit: §15 of the blueprint says changing an agent's authority
must be independently authorized, and a `kind` that could ride along in a label change is
precisely the side effect that forbids. Rotation preserves the kind, or rotating an agent's
key would quietly promote it.

**An agent with no delegation in force cannot create live payments** —
`403 not_permitted`, with `details.credential_kind: "agent"`. "In force" is strict, and the
strictness is the point:

- a rule **bound to this credential** (`scope.credentialIds`) counts;
- the environment default does **not**, because it bounds every caller and so bounds an
  agent no differently — accepting it would make the declaration mean nothing;
- an organization-wide rule does not either: that is a policy, not a delegation;
- a disabled rule, a lapsed one (`notAfter` in the past) and one scoped to the other
  environment are all not in force.

The sandbox is exempt. An environment that exists to be rehearsed in must not refuse, or the
only lesson an integrator takes from it is to skip it.

An agent cannot widen its own authority: the rules live on the organization's limit table,
and editing them is a dashboard action by a person holding `credentials.manage_live`.

## The domain journal

`core/journal.ts` is one **versioned** internal record of what happened (`v`, type, subject,
actor, correlation id, small non-sensitive `data`), with additional destinations registered
through `onDomainEvent` so the journal itself depends on nothing. It is not a queue and
replaces none of the four existing stores (`payment.events`, inbound provider events, the
per-org audit trail, the hash-chained compliance record) — it is the spine they are
projections of, written before the consumers that would otherwise each invent one.

Rules it keeps: `emit()` never throws (a sink that throws is recorded as a `failedSinks`
entry and counted in `journalStats()`); an undeclared type is kept and flagged rather than
refused; `data` carries identifiers, amounts, states and reasons, never a raw provider body
or a secret. Producers so far: every payment transition, and every undeclared state
transition (`transition.undeclared`), so the transition table's log-only phase is readable
from the console instead of Railway's truncated log tail.

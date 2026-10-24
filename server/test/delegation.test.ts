/* ============================================================
   Delegated authority — what a machine may do, not only how much.

   A limit rule could previously say only "how much": ceilings and velocity. §15 of the
   blueprint asks for the rest of a delegation — who may be paid, over which operator, to
   which country, funded how, until when, and above what amount a person must look. This
   asserts the parts an over-permissive implementation would quietly skip:

     • an ABSENT allow-list must constrain NOTHING (every rule written before this existed
       has to behave exactly as it did — otherwise the migration breaks live organizations);
     • a recipient allow-list must not be defeated by writing the number differently;
     • a rule bound to a credential must not apply to a caller that did not identify itself,
       which would hand one machine's delegation to everybody;
     • a delegation must only ever TIGHTEN the approval threshold.
   Run: pnpm --filter @momome/server test:delegation
   ============================================================ */
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { checkLimits, upsertLimitRule, deleteLimitRule, _resetLimits } = await import("../src/core/platform/limits.js");

  const base = { orgId: "org_a", env: "test" as const, plan: "free", country: "CM", asset: "BTC", currency: "XAF", operator: "MTN", xaf: 50_000 };
  const rule = (over: Record<string, unknown>) => upsertLimitRule({
    name: "agent delegation", enabled: true, priority: 1,
    scope: { orgIds: ["org_a"], envs: ["test"] }, ceilings: {}, ...over,
  } as Parameters<typeof upsertLimitRule>[0]);

  console.log("\nDelegated authority");

  /* 1. The migration guarantee: a rule with no allow block constrains nothing. */
  _resetLimits();
  const plain = rule({});
  let r = await checkLimits({ ...base, recipient: "670123456", method: "LIGHTNING" });
  ok("a rule with no allow-list permits everything", r.ok === true, JSON.stringify(r).slice(0, 90));
  // …and an EMPTY list is the same as none. A length-zero array read as "deny all" would
  // refuse every payment the moment an operator cleared a list in the console.
  deleteLimitRule(plain.id);
  rule({ allow: { recipients: [], destinationOperators: [], fundingMethods: [], destinationCountries: [] } });
  r = await checkLimits({ ...base, recipient: "670123456", method: "LIGHTNING" });
  ok("an empty allow-list is not a deny-all", r.ok === true);

  /* 2. Recipients. */
  _resetLimits();
  rule({ allow: { recipients: ["670123456"] } });
  r = await checkLimits({ ...base, recipient: "670123456", method: "LIGHTNING" });
  ok("an approved recipient is paid", r.ok === true);
  r = await checkLimits({ ...base, recipient: "677999999", method: "LIGHTNING" });
  ok("an un-approved recipient is refused", r.ok === false && r.limit === "recipient_not_allowed", r.ok ? "" : r.limit);
  // The same number written with its country code is the same number.
  r = await checkLimits({ ...base, recipient: "+237670123456", method: "LIGHTNING" });
  ok("the country code does not defeat the allow-list", r.ok === true);
  // A caller that does not say who it is paying cannot satisfy a recipient allow-list.
  r = await checkLimits({ ...base, method: "LIGHTNING" });
  ok("an unstated recipient cannot pass a recipient allow-list", r.ok === false && r.limit === "recipient_not_allowed");

  /* 3. Operator, country, funding method. */
  _resetLimits();
  rule({ allow: { destinationOperators: ["MTN"], destinationCountries: ["CM"], fundingMethods: ["LIGHTNING"] } });
  ok("the permitted combination passes", (await checkLimits({ ...base, method: "LIGHTNING" })).ok === true);
  r = await checkLimits({ ...base, operator: "ORANGE", method: "LIGHTNING" });
  ok("another operator is refused", r.ok === false && r.limit === "operator_not_allowed", r.ok ? "" : r.limit);
  r = await checkLimits({ ...base, country: "CI", method: "LIGHTNING" });
  ok("another jurisdiction is refused", r.ok === false && r.limit === "country_not_allowed", r.ok ? "" : r.limit);
  r = await checkLimits({ ...base, method: "USDT" });
  ok("another funding method is refused", r.ok === false && r.limit === "funding_method_not_allowed", r.ok ? "" : r.limit);

  /* 4. Scope vs allow — the distinction the whole design rests on. A rule SCOPED to MTN
        has an opinion about MTN payments only; it does not thereby forbid Orange. */
  _resetLimits();
  rule({ scope: { orgIds: ["org_a"], envs: ["test"], operators: ["MTN"] }, ceilings: { maxTransactionXaf: 1_000 } });
  r = await checkLimits({ ...base, operator: "MTN", method: "LIGHTNING" });
  ok("a rule scoped to MTN binds MTN", r.ok === false && r.limit === "max_transaction_amount");
  r = await checkLimits({ ...base, operator: "ORANGE", method: "LIGHTNING" });
  ok("…and says nothing about Orange", r.ok === true);

  /* 5. Bound to one credential. */
  _resetLimits();
  rule({ scope: { orgIds: ["org_a"], envs: ["test"], credentialIds: ["cred_agent"] }, ceilings: { maxTransactionXaf: 1_000 } });
  r = await checkLimits({ ...base, credentialId: "cred_agent", method: "LIGHTNING" });
  ok("the bound credential is constrained", r.ok === false && r.limit === "max_transaction_amount");
  r = await checkLimits({ ...base, credentialId: "cred_other", method: "LIGHTNING" });
  ok("another credential in the same org is not", r.ok === true);
  // Unknown ≠ everyone. A subject with no credential must not inherit the delegation.
  r = await checkLimits({ ...base, method: "LIGHTNING" });
  ok("a caller that did not identify itself does not inherit it", r.ok === true);

  /* 6. Validity window. */
  _resetLimits();
  rule({ ceilings: { maxTransactionXaf: 1_000 }, notAfter: "2020-01-01T00:00:00Z" });
  ok("an expired delegation no longer applies", (await checkLimits({ ...base, method: "LIGHTNING" })).ok === true);
  _resetLimits();
  rule({ ceilings: { maxTransactionXaf: 1_000 }, notBefore: "2999-01-01T00:00:00Z" });
  ok("a delegation that has not started yet does not apply", (await checkLimits({ ...base, method: "LIGHTNING" })).ok === true);
  _resetLimits();
  rule({ ceilings: { maxTransactionXaf: 1_000 }, notBefore: "2020-01-01T00:00:00Z", notAfter: "2999-01-01T00:00:00Z" });
  ok("a delegation inside its window applies", (await checkLimits({ ...base, method: "LIGHTNING" })).ok === false);

  /* 7. Approval threshold: the tightest of the matching rules, returned not enforced. */
  _resetLimits();
  rule({ requireApprovalAboveXaf: 100_000 });
  rule({ name: "tighter", requireApprovalAboveXaf: 25_000 });
  r = await checkLimits({ ...base, method: "LIGHTNING" });
  ok("the tightest approval threshold is the one returned", r.ok === true && r.approvalAboveXaf === 25_000, r.ok ? String(r.approvalAboveXaf) : "");
  _resetLimits();
  rule({});
  r = await checkLimits({ ...base, method: "LIGHTNING" });
  ok("no threshold is returned when no rule asks for one", r.ok === true && r.approvalAboveXaf === undefined);

  /* 8. END TO END: the threshold does not merely come back from checkLimits, it has to
        actually hold the payment. The global default is effectively unlimited, so this is
        a hold that exists ONLY because the delegation asked for it — and the note must say
        whose decision it was, or an operator cannot tell it from the global threshold. */
  const { store } = await import("../src/db/store.js");
  const { confirmInbound } = await import("../src/core/stateMachine.js");
  const now = new Date().toISOString();
  const xaf = 50_000, feeXaf = 1_250;
  const held = {
    id: "del1", ref: "MMM-DEL-1", quoteId: "q_del1",
    state: "AWAITING_INBOUND" as const, displayStatus: "Pending" as const, method: "LIGHTNING" as const,
    recipient: { phone: "677000000", country: "CM" as const, provider: "MTN" as const, name: "", nameSource: "manual" as const },
    xaf, feeXaf, totalXaf: xaf + feeXaf, usd: 80,
    payInstruction: { method: "LIGHTNING" as const, code: "lnbc_del1", qr: "lightning:lnbc_del1", asset: "BTC" as const, amount: 0.0008, amountLabel: "0.0008 BTC", expiresAt: now, providerRef: "ph_del1", provider: "sandbox" },
    events: [{ at: now, state: "QUOTED" as const }, { at: now, state: "AWAITING_INBOUND" as const }],
    createdAt: now, updatedAt: now,
    approvalAboveXaf: 25_000, // the delegation's threshold, stamped at creation
  };
  await store().putPayment(held);
  await confirmInbound(held, held.payInstruction.amount);
  const after = await store().getPayment(held.id);
  const note = after?.events.filter((e) => e.state === "MANUAL_REVIEW").slice(-1)[0]?.note ?? "";
  ok("a delegated threshold holds a payment the global one would have let through", after?.state === "MANUAL_REVIEW", `${after?.state} · ${note}`);
  ok("…and the note says the delegation did it", note.includes("delegation"), note);

  console.log(`\n✅ delegation: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

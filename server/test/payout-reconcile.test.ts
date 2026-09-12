/* Payout-side reconciliation — the provider's word against our payment state.
   payoutVerdict is pure; every cell of the table in docs/reconciliation is asserted. Then
   the report itself, with a fake live payout rail: a statement row we have no payment for
   is missing_internal, a delivered payment the provider calls FAILED is state_mismatch, an
   agreeing pair is matched, a rail without a statement is re-queried per payment.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/payout-reconcile.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { payoutVerdict, reconciliationReport, reconciliationSweep } = await import("../src/core/interop/reconcile.js");
  const { listNotifications } = await import("../src/core/notifications.js");
  const payouts = await import("../src/adapters/payouts.js");
  const { store } = await import("../src/db/store.js");
  type State = Parameters<typeof payoutVerdict>[0];

  console.log("\npayoutVerdict — the table\n");
  const v = (s: State, p: "COMPLETED" | "FAILED" | "PENDING" | null) => payoutVerdict(s, p).verdict;
  ok("DELIVERED + COMPLETED → matched", v("DELIVERED", "COMPLETED") === "matched");
  ok("FAILED + FAILED → matched", v("FAILED", "FAILED") === "matched");
  ok("REFUNDED + FAILED → matched", v("REFUNDED", "FAILED") === "matched");
  ok("DELIVERED + FAILED → state_mismatch (recipient told paid, not paid)", v("DELIVERED", "FAILED") === "state_mismatch");
  ok("DELIVERED + PENDING → state_mismatch", v("DELIVERED", "PENDING") === "state_mismatch");
  ok("REFUNDED + COMPLETED → state_mismatch (paid AND refunded)", v("REFUNDED", "COMPLETED") === "state_mismatch");
  ok("FAILED + COMPLETED → state_mismatch", v("FAILED", "COMPLETED") === "state_mismatch");
  ok("PAYOUT_REQUESTED + PENDING → pending", v("PAYOUT_REQUESTED", "PENDING") === "pending");
  ok("PAYOUT_REQUESTED + COMPLETED → pending (settle will catch up)", v("PAYOUT_REQUESTED", "COMPLETED") === "pending");
  ok("no provider record → pending, never a mismatch", v("DELIVERED", null) === "pending");

  console.log("\nreconciliationReport — payouts scope\n");
  // Three payments in the store with a payout behind them, attributed to two fake rails.
  const now = new Date().toISOString();
  const mk = (ref: string, state: State, agg: string, xaf: number) => ({
    id: `pay_${ref}`, ref, state, xaf, method: "LIGHTNING", createdAt: now, updatedAt: now, payoutRef: `ext_${ref}`, aggregator: agg, senderId: "dev", events: [{ state, at: now }],
    payInstruction: { method: "LIGHTNING", amount: 1, expiresAt: now, provider: "sandbox" }, recipient: { phone: "699000111", country: "CM", provider: "MTN" },
  }) as unknown as Parameters<ReturnType<typeof store>["putPayment"]>[0];
  await store().putPayment(mk("MMM-1", "DELIVERED", "fake_statement", 1000));
  await store().putPayment(mk("MMM-2", "DELIVERED", "fake_statement", 2000));
  await store().putPayment(mk("MMM-3", "REFUNDED", "fake_query", 3000));
  await store().putPayment(mk("MMM-4", "DELIVERED", "fake_query", 4000));

  const base = { priority: 9, configured: () => true, live: () => true, supports: () => true, disburse: async () => ({ status: "accepted" as const, providerRef: "x", simulated: false }), balance: async () => null, statusByKey: () => null };
  const withStatement: payouts.PayoutAdapter = { ...base, name: "fake_statement", queryStatus: async () => "PENDING",
    listPayouts: async () => [
      { ref: "MMM-1", providerRef: "p1", status: "COMPLETED", amountXaf: 1000 },
      { ref: "MMM-2", providerRef: "p2", status: "FAILED", amountXaf: 2000, raw: "rejected" },
      { ref: "MMM-GHOST", providerRef: "p9", status: "COMPLETED", amountXaf: 50_000, raw: "paid" },
    ] };
  const queryOnly: payouts.PayoutAdapter = { ...base, name: "fake_query", queryStatus: async (ref) => (ref === "MMM-3" ? "COMPLETED" : "COMPLETED") };
  payouts.PAYOUTS.push(withStatement, queryOnly);
  try {
    const rep = await reconciliationReport(3);
    const po = rep.records.filter((r) => r.scope === "payouts");
    const byRef = (ref: string) => po.find((r) => r.internalPaymentRef === ref);
    ok("statement row agreeing with DELIVERED is matched", byRef("MMM-1")?.verdict === "matched");
    ok("statement row FAILED against our DELIVERED is state_mismatch", byRef("MMM-2")?.verdict === "state_mismatch", byRef("MMM-2")?.detail);
    const ghost = po.find((r) => r.externalId === "p9");
    ok("a payout the provider holds that we have no payment for is missing_internal", ghost?.verdict === "missing_internal" && ghost.externalAmount === 50_000, ghost?.detail);
    ok("a rail without a statement is re-queried per payment: REFUNDED + COMPLETED is state_mismatch", byRef("MMM-3")?.verdict === "state_mismatch", byRef("MMM-3")?.detail);
    ok("…and DELIVERED + COMPLETED is matched", byRef("MMM-4")?.verdict === "matched");
    ok("totals count state_mismatch", rep.totals.state_mismatch === 2 && rep.totals.missing_internal >= 1, JSON.stringify(rep.totals));
    ok("every payout record is tagged with its scope and XAF", po.every((r) => r.scope === "payouts" && r.asset === "XAF"));
    const sent = await reconciliationSweep(Date.now());
    const alerts = listNotifications().filter((n) => n.kind === "reconciliation_mismatch");
    ok("the sweep tells the operator about each money-relevant verdict, once", sent === 3 && alerts.length === 3, `${sent} sent, ${alerts.length} recorded`);
    ok("…naming the payment and the disagreement", alerts.some((n) => n.body.includes("MMM-2") && /state mismatch/.test(n.body)), alerts[0]?.body.slice(0, 120));
    ok("a second sweep in the same window sends nothing", (await reconciliationSweep(Date.now())) === 0);
    ok("…and a later one re-alerts nothing already told", (await reconciliationSweep(Date.now() + 7 * 3600_000)) === 0);
  } finally { payouts.PAYOUTS.splice(payouts.PAYOUTS.indexOf(withStatement), 1); payouts.PAYOUTS.splice(payouts.PAYOUTS.indexOf(queryOnly), 1); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

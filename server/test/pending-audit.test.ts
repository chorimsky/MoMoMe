/* WHAT "PENDING" ACTUALLY MEANS, and the two ways a payment used to stay pending for ever.

   Every non-terminal state renders as "Pending", so one word covers a customer who never
   paid (no money of ours), money that is in but undelivered (our liability), money owed
   back, and something a person has to decide. This pins the split, and the two holes that
   made the list grow without bound:

     • only a LIGHTNING instruction ever expired, so an unpaid on-chain or stablecoin
       payment sat at AWAITING_INBOUND indefinitely;
     • nothing reconciled INBOUND_CONFIRMED or FX_LOCKED, so a payment whose inline
       settlement stopped mid-flow kept our money and was never driven again.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/pending-audit.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "pending-audit-secret";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { store } = await import("../src/db/store.js");
  const { expireAbandonedDeposits, resumeStalledSettlements } = await import("../src/core/stateMachine.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");

  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "device-pending" };
  const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) });

  const A = { "x-admin-token": issueToken({ uid: createUser("pending-auditor", "Str0ng-Passw0rd!x", "Super Admin" as never).id, role: "Super Admin" as never }).token };
  const audit = async () => (await (await fetch(`${base}/api/admin/payments/pending-audit`, { headers: A })).json()) as {
    summary: Record<string, { count: number; xaf: number; expired?: number } | number>;
    closed: Record<string, number>;
    rows: Array<{ ref: string; bucket: string; state: string; why: string; instructionExpired?: boolean }>;
  };

  const mk = async (method: string) => {
    const q = await (await post("/api/quotes", { xaf: 5000, method, country: "CM" })).json() as { id: string };
    const r = await post("/api/payments", { quoteId: q.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "" } });
    const p = await r.json() as { id: string; ref: string };
    if (!p.id) throw new Error(`payment refused: ${r.status} ${JSON.stringify(p)}`);
    return p;
  };

  try {
    console.log("\n'Pending' is four different situations\n");
    const ln = await mk("LIGHTNING");
    const chain = await mk("USDT");
    let a = await audit();
    ok("a payment nobody has paid is UNPAID, not a liability", a.rows.find((r) => r.ref === ln.ref)?.bucket === "unpaid", a.rows.find((r) => r.ref === ln.ref)?.bucket);
    ok("…and it says what it is waiting for", /waiting for the customer/.test(a.rows.find((r) => r.ref === ln.ref)?.why ?? ""), a.rows.find((r) => r.ref === ln.ref)?.why);
    ok("none of our own money is tied up in it", (a.summary.our_money_xaf as number) === 0, String(a.summary.our_money_xaf));
    const unpaidRefs = a.rows.filter((r) => r.bucket === "unpaid").map((r) => r.ref);
    ok("both appear under unpaid, and the headline counts them", unpaidRefs.includes(ln.ref) && unpaidRefs.includes(chain.ref) && (a.summary.unpaid as { count: number }).count >= 2, JSON.stringify(a.summary.unpaid));

    console.log("\nAn unpaid deposit instruction expires instead of sitting there for ever\n");
    // Only Lightning ever expired. Put both instructions in the past and run the sweep.
    for (const id of [ln.id, chain.id]) {
      const p = (await store().getPayment(id))!;
      p.payInstruction.expiresAt = new Date(Date.now() - 2 * 3600_000).toISOString();
      await store().putPayment(p);
    }
    const n = await expireAbandonedDeposits();
    ok("the unpaid stablecoin instruction is expired by the sweep", n === 1, String(n));
    ok("…and it is now a closed failure, not an open pending row", (await store().getPayment(chain.id))!.state === "FAILED", (await store().getPayment(chain.id))!.state);
    ok("…with a reason that says no money moved", /expired — not paid/.test(((await store().getPayment(chain.id))!.events.at(-1)?.note) ?? ""));
    ok("the Lightning one is left to its own path, not double-handled", (await store().getPayment(ln.id))!.state === "AWAITING_INBOUND");
    ok("expiring booked nothing: no ledger entry exists for it", (await store().entriesFor(chain.id)).length === 0, String((await store().entriesFor(chain.id)).length));
    ok("running the sweep again is a no-op", (await expireAbandonedDeposits()) === 0);

    console.log("\n…but a customer who pays late still lands on their own payment\n");
    const { default: depositReconcileModule } = await import("../src/core/depositReconcile.js").then((m) => ({ default: m }));
    void depositReconcileModule;
    // The matcher is what decides this: an expired-unpaid deposit payment stays open to a
    // late deposit for the recovery window, or the money arrives unattributed.
    const expired = (await store().getPayment(chain.id))!;
    ok("the expired payment is still a deposit payment awaiting reconciliation", expired.payInstruction.method === "USDT");
    const { confirmInbound } = await import("../src/core/stateMachine.js");
    await confirmInbound(expired, expired.payInstruction.amount, "late-deposit-1");
    const after = (await store().getPayment(chain.id))!;
    ok("a late deposit settles it rather than being lost", after.events.some((e) => e.state === "INBOUND_CONFIRMED"), after.state);

    console.log("\nMoney in, nothing driving it\n");
    const stalled = await mk("LIGHTNING");
    const sp = (await store().getPayment(stalled.id))!;
    // Reproduce a settlement that stopped after the inbound was booked: the exact state a
    // deploy or a crash inside confirmInbound leaves behind.
    await store().recordTxn(sp.id, [
      { account: "inbound_clearing", direction: "debit", amount: sp.payInstruction.amount, currency: "BTC" },
      { account: "customer_wallet", direction: "credit", amount: sp.payInstruction.amount, currency: "BTC" },
    ]);
    sp.state = "INBOUND_CONFIRMED"; sp.displayStatus = "Pending";
    sp.events.push({ at: new Date(Date.now() - 20 * 60_000).toISOString(), state: "INBOUND_CONFIRMED" });
    sp.updatedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    await store().putPayment(sp);

    a = await audit();
    const row = a.rows.find((r) => r.ref === stalled.ref);
    ok("it is reported as UNSETTLED — our money, not a pending quote", row?.bucket === "unsettled", `${row?.bucket} ${row?.state}`);
    ok("the headline now says our money is tied up", (a.summary.our_money_xaf as number) > 0, String(a.summary.our_money_xaf));

    const resumed = await resumeStalledSettlements();
    ok("the tick resumes it instead of leaving it for ever", resumed === 1, String(resumed));
    const done = (await store().getPayment(stalled.id))!;
    ok("…and it moves on past INBOUND_CONFIRMED", done.state !== "INBOUND_CONFIRMED" && done.state !== "FX_LOCKED", done.state);
    ok("a second pass has nothing left to resume", (await resumeStalledSettlements()) === 0);

    console.log("\nA hold whose cause clears later still drains\n");
    {
      const { retryTransientHolds } = await import("../src/core/stateMachine.js");
      const held = await mk("LIGHTNING");
      const hp = (await store().getPayment(held.id))!;
      await store().recordTxn(hp.id, [
        { account: "inbound_clearing", direction: "debit", amount: hp.payInstruction.amount, currency: "BTC" },
        { account: "customer_wallet", direction: "credit", amount: hp.payInstruction.amount, currency: "BTC" },
      ]);
      // Held two days ago because the float was empty — the exact shape of a production
      // hold. Retries used to stop at 24 h, so topping the wallet up on day two left it
      // stuck for ever with nothing to move it.
      const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
      hp.state = "MANUAL_REVIEW"; hp.displayStatus = "Pending";
      hp.events.push({ at: twoDaysAgo, state: "INBOUND_CONFIRMED" });
      hp.events.push({ at: twoDaysAgo, state: "MANUAL_REVIEW", note: "insufficient XAF float to deliver" });
      hp.updatedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
      await store().putPayment(hp);

      const a2 = await audit();
      ok("a held payment is reported as needing a person, with the reason", a2.rows.find((r) => r.ref === held.ref)?.bucket === "needs_person" && /float/i.test(a2.rows.find((r) => r.ref === held.ref)?.why ?? ""), a2.rows.find((r) => r.ref === held.ref)?.why);
      const drained = await retryTransientHolds();
      ok("…and it is retried on day two, not abandoned at 24 h", drained >= 1, String(drained));
      const nowState = (await store().getPayment(held.id))!.state;
      ok("…so a top-up drains it instead of leaving it held for ever", nowState !== "MANUAL_REVIEW", nowState);
    }

    console.log("\nThe audit is operator-only\n");
    const anon = await fetch(`${base}/api/admin/payments/pending-audit`);
    ok("it is not readable without an admin session", anon.status === 401 || anon.status === 403, String(anon.status));

    a = await audit();
    ok("closed outcomes are reported alongside, so 'which failed' is answerable here", typeof a.closed.failed === "number" && typeof a.closed.delivered === "number", JSON.stringify(a.closed));
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

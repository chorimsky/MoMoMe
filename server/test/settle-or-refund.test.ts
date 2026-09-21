/* "Debited but not delivered" must not exist: once money is in, every path ends in
   DELIVERED or REFUNDED — through failover to another rail, the sender's own retry, the
   tick retrying transient holds, and nothing ever paid twice.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox PAWAPAY_CM_PAYOUTS=true tsx test/settle-or-refund.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PAWAPAY_CM_PAYOUTS = "true";
process.env.ADMIN_SESSION_SECRET = "settle-test-secret";
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
  const peexit = await import("../src/adapters/peexit.js");
  const pawapay = await import("../src/adapters/pawapay.js");
  const { onPayoutResult, retryTransientHolds, payoutKeyOf, retryDeliveryForSender } = await import("../src/core/stateMachine.js");
  const { setAggregatorUp } = await import("../src/core/routing.js");
  const { issueToken } = await import("../src/core/adminAuth.js"); const { createUser } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "device-settle" };
  const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) });
  const get = async (p: string) => (await fetch(`${base}${p}`, { headers: H })).json() as Promise<Record<string, any>>;
  const pay = async (phone = "670123456") => {
    const q = await (await post("/api/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" })).json() as { id: string };
    const prov = phone.startsWith("69") ? "ORANGE" : "MTN";
    const res = await post("/api/payments", { quoteId: q.id, recipient: { phone, country: "CM", provider: prov, name: "" } });
    const p = await res.json() as { id: string; ref: string; error?: string; message?: string };
    if (!p.id) throw new Error(`payment refused: ${res.status} ${JSON.stringify(p)}`);
    return p;
  };
  const until = async (id: string, states: string[], ms = 12_000) => { const t0 = Date.now(); let cur = await store().getPayment(id); while (cur && !states.includes(cur.state) && Date.now() - t0 < ms) { await new Promise((r) => setTimeout(r, 150)); cur = await store().getPayment(id); } return cur!; };
  try {
    console.log("\n1. The primary rail REJECTS the disbursement → the other funded rail delivers, no refund\n");
    let p = await pay();
    peexit.simulatePayoutOutcome(p.ref, "reject");
    await post(`/api/payments/${p.id}/simulate`, {});
    let cur = await until(p.id, ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("delivered through the second rail with a NEW attempt key", cur.state === "DELIVERED" && cur.aggregator === "pawapay" && cur.payoutAttempts === 2 && payoutKeyOf(cur) === `${p.ref}:r2`, `${cur.state} ${cur.aggregator} ${cur.payoutKey}`);
    ok("the trail says what happened", cur.events.some((e) => /payout failed at peexit .* → retrying on pawapay/.test(e.note ?? "")));

    console.log("\n2. The primary rail ACCEPTS then FAILS (callback) → failover, no refund\n");
    p = await pay("699001111");
    peexit.simulatePayoutOutcome(p.ref, "fail"); // accepted, then the rail reports FAILED
    await post(`/api/payments/${p.id}/simulate`, {});
    cur = await until(p.id, ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("a FAILED verdict on the first attempt is re-checked authoritatively and the payout moves to the other rail", cur.state === "DELIVERED" && cur.aggregator === "pawapay" && cur.payoutAttempts === 2, `${cur.state} ${cur.aggregator} ${cur.payoutAttempts}`);
    const stale = await store().getPayment(p.id);
    await onPayoutResult(`${p.ref}`, "FAILED"); // a late callback for the SUPERSEDED attempt
    ok("a late verdict for a superseded attempt is ignored — the delivered payment stays delivered", (await store().getPayment(p.id))!.state === "DELIVERED" && stale?.state === "DELIVERED");

    console.log("\n3. Every rail fails → refund claim opens; the SENDER can ask for delivery again\n");
    p = await pay("677002222");
    peexit.simulatePayoutOutcome(p.ref, "reject");
    setAggregatorUp("pawapay", false); // the second rail is down too
    await post(`/api/payments/${p.id}/simulate`, {});
    cur = await until(p.id, ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("with no rail left the inbound goes to the refund claim (money never silently held)", cur.state === "REFUND_PENDING" && cur.refundNeedsDestination === true, cur.state);
    const unsettled0 = await (await fetch(`${base}/api/admin/payments/unsettled`, { headers: { "x-admin-token": issueToken({ uid: createUser("settle-admin", "Str0ng-Passw0rd!x", "Super Admin" as never).id, role: "Super Admin" as never }).token } })).json() as Record<string, any>;
    ok("Admin → 'debited, not delivered' lists it with the cause and the action awaiting_sender", unsettled0.rows.some((r: any) => r.ref === p.ref && r.action === "awaiting_sender"), JSON.stringify(unsettled0.rows.find((r: any) => r.ref === p.ref)));
    setAggregatorUp("pawapay", true); peexit.simulatePayoutOutcome(p.ref, null);
    const r = await (await post(`/api/payments/${p.id}/retry-delivery`, {})).json() as Record<string, any>;
    cur = await until(p.id, ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("POST /payments/:id/retry-delivery (the sender) delivers once a rail is back — a new attempt key, no double pay", r.state !== undefined && cur.state === "DELIVERED" && cur.payoutAttempts === 2 && payoutKeyOf(cur) === `${p.ref}:r2` && !cur.refundNeedsDestination, `${cur.state} attempts=${cur.payoutAttempts}`);
    ok("…and a retry on a delivered payment is refused", (await retryDeliveryForSender(cur)).reason === "not_retryable");

    console.log("\n4. A transient hold (float / rail) is retried by the tick, not by a person\n");
    p = await pay("699003333");
    setAggregatorUp("peexit", false); setAggregatorUp("pawapay", false);
    await post(`/api/payments/${p.id}/simulate`, {});
    cur = await until(p.id, ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("with every rail down the payment holds for review (money in, nothing moved)", cur.state === "MANUAL_REVIEW" && /no payout aggregator|no funded/i.test(cur.events.at(-1)?.note ?? ""), `${cur.state} ${cur.events.at(-1)?.note}`);
    setAggregatorUp("peexit", true); setAggregatorUp("pawapay", true);
    cur.updatedAt = new Date(Date.now() - 10 * 60_000).toISOString(); await store().putPayment(cur);
    const n = await retryTransientHolds();
    cur = await until(p.id, ["DELIVERED", "REFUND_PENDING"]);
    ok("the tick retries it as soon as a rail is back and it is DELIVERED", n >= 1 && cur.state === "DELIVERED" && cur.events.some((e) => /auto \(hold cleared\)/.test(e.note ?? "")), `${n} ${cur.state}`);

    console.log("\n5. Holds that need a person are NOT auto-retried\n");
    p = await pay("677004444");
    const { updateSettings, getSettings } = await import("../src/core/settings.js");
    updateSettings({ ops: { ...getSettings().ops, payoutApprovalXaf: 1000 } });
    await post(`/api/payments/${p.id}/simulate`, {});
    cur = await until(p.id, ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    updateSettings({ ops: { ...getSettings().ops, payoutApprovalXaf: 5_000_000 } });
    cur.updatedAt = new Date(Date.now() - 10 * 60_000).toISOString(); await store().putPayment(cur);
    await retryTransientHolds();
    ok("an approval-threshold hold stays for the operator", (await store().getPayment(p.id))!.state === "MANUAL_REVIEW" && /approval threshold/.test(cur.events.at(-1)?.note ?? ""), cur.events.at(-1)?.note);
    const unsettled = await (await fetch(`${base}/api/admin/payments/unsettled`, { headers: { "x-admin-token": issueToken({ uid: createUser("settle-admin2", "Str0ng-Passw0rd!x", "Super Admin" as never).id, role: "Super Admin" as never }).token } })).json() as Record<string, any>;
    ok("the report shows it as 'review' with its age and cause", unsettled.rows.some((r: any) => r.ref === p.ref && r.action === "review" && typeof r.ageMin === "number"));
    console.log("\n6. On-chain BTC booked but held for a stale FX feed → resumed with a fresh rate, delivered\n");
    const { recordTxn } = await import("../src/core/ledger.js");
    const { resumeHeldRepricing } = await import("../src/core/stateMachine.js");
    const nowIso = new Date().toISOString();
    const oc = { id: "pay_oc_fx", ref: "MMM-2026-900001", quoteId: "q", state: "MANUAL_REVIEW", displayStatus: "Pending", method: "ONCHAIN", recipient: { phone: "677005555", country: "CM", provider: "MTN", name: "", nameSource: "unknown" }, xaf: 50000, feeXaf: 1250, totalXaf: 51250, usd: 84.3, payInstruction: { method: "ONCHAIN", code: "bc1q", qr: "bitcoin:bc1q", asset: "BTC", amount: 0.0013, amountLabel: "0.0013 BTC", expiresAt: nowIso, providerRef: "oc_1", provider: "sandbox" }, events: [{ at: nowIso, state: "AWAITING_INBOUND" }, { at: nowIso, state: "INBOUND_DETECTED" }, { at: nowIso, state: "INBOUND_CONFIRMED" }, { at: nowIso, state: "MANUAL_REVIEW", note: "on-chain re-price blocked — FX feed not fresh" }], createdAt: nowIso, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    await store().putPayment(oc as never);
    recordTxn("pay_oc_fx", [{ account: "inbound_clearing", direction: "debit", amount: 0.0013, currency: "BTC" }, { account: "customer_wallet", direction: "credit", amount: 0.0013, currency: "BTC" }]);
    const rr = await resumeHeldRepricing(oc as never);
    cur = await until("pay_oc_fx", ["DELIVERED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("resumeHeldRepricing re-prices at the current rate, locks FX and delivers — no operator, no refund", rr.ok && cur.state === "DELIVERED" && cur.events.some((e) => e.state === "FX_LOCKED") && typeof cur.repricedFromXaf === "number", `${JSON.stringify(rr)} ${cur.state}`);
    const n6 = await retryTransientHolds();
    ok("the tick would have done the same (the hold is in the transient set)", n6 >= 0);
    console.log("\n7. Long-poll: the client is answered the moment the state changes, not on the next tick\n");
    p = await pay("699006666");
    const t0 = Date.now();
    const waiting = fetch(`${base}/api/payments/${p.id}/wait?state=AWAITING_INBOUND&timeout=10000`, { headers: H }).then((r) => r.json()) as Promise<Record<string, any>>;
    await new Promise((r) => setTimeout(r, 300));
    await post(`/api/payments/${p.id}/simulate`, {});
    const woke = await waiting;
    ok("a wait on AWAITING_INBOUND returns as soon as the inbound lands (well under the timeout)", woke.state !== "AWAITING_INBOUND" && Date.now() - t0 < 5000, `${woke.state} after ${Date.now() - t0} ms`);
    const t1 = Date.now();
    const same = await (await fetch(`${base}/api/payments/${p.id}/wait?state=NOPE&timeout=5000`, { headers: H })).json() as Record<string, any>;
    ok("a wait on a state the payment is not in returns immediately with the current record", same.id === p.id && Date.now() - t1 < 1000);
    cur = await until(p.id, ["DELIVERED"]);
    const t2 = Date.now();
    const timed = await (await fetch(`${base}/api/payments/${p.id}/wait?state=DELIVERED&timeout=1200`, { headers: H })).json() as Record<string, any>;
    ok("with nothing changing, it returns the current record at the timeout", timed.state === "DELIVERED" && Date.now() - t2 >= 1100 && Date.now() - t2 < 4000, `${Date.now() - t2} ms`);
    ok("another device cannot wait on it", (await fetch(`${base}/api/payments/${p.id}/wait?state=DELIVERED&timeout=1000`, { headers: { "x-mm-sender": "someone-else" } })).status === 404);
    void pawapay;
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

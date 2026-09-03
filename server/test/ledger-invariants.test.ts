/* System-wide money invariants after a realistic mix of payment outcomes.

   recordTxn already rejects an unbalanced TRANSACTION, so no single posting can break the
   books. What nothing checked is the state of the SYSTEM after real traffic: deliveries,
   payments parked for review, and refunds interleaved. Every money bug found on this
   project so far was of exactly that shape — a leg posted on one path and not its mirror
   on another. The float that destroyed itself at the rate of attempted payments passed
   every per-transaction check; it only shows up when you ask what the accounts hold once
   the dust settles.

   These are the properties that must hold before real money moves:
     1. Double entry — every currency nets to zero across the whole ledger.
     2. Non-custody — customer_wallet is a transit leg and must rest at zero. Holding
        customer crypto is custody, a materially different regulated activity.
     3. Earmarks are held only by payments actually in flight. A parked or finished
        payment holding one is float destroyed for good.
     4. Liabilities are explicit — refund_payable is money that is not ours.
     5. No orphan postings — every entry belongs to a payment that exists. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PUBLIC_URL = "https://example.test";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

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
  const { ensureRatesFresh } = await import("../src/core/rates.js");
  const { store } = await import("../src/db/store.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "ledger-invariants" };
  const post = async (p: string, b: unknown) =>
    (await fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) })).json() as any;
  const get = async (p: string) => (await fetch(`${base}${p}`, { headers: H })).json() as any;

  try {
    console.log("\nLedger invariants — after a realistic mix of outcomes\n");
    await ensureRatesFresh().catch(() => {});

    const recipient = { phone: "677000789", country: "CM", provider: "MTN", name: "Test Recipient" };
    const settled: string[] = [];

    // Lower the operator approval threshold so a large payment PARKS after FX-lock rather
    // than being refused before it. That is the path that used to strand an earmark: the
    // reservation is already taken when the guard fires. (By default the threshold sits
    // above the corridor cap, so nothing can reach it.)
    const { updateSettings, getSettings } = await import("../src/core/settings.js");
    updateSettings({ ops: { ...getSettings().ops, payoutApprovalXaf: 100_000 } });

    // A spread of amounts: ordinary deliveries below the threshold, and one above it that
    // must park for review.
    for (const xaf of [5_000, 25_000, 400_000]) {
      const q = await post("/api/quotes", { xaf, method: "LIGHTNING", country: "CM" });
      if (!q?.id) continue;
      const p = await post("/api/payments", { quoteId: q.id, recipient });
      if (!p?.id) continue;
      await post(`/api/payments/${p.id}/simulate`, {});
      settled.push(p.id);
    }
    // Settlement is backgrounded — wait for the state machine to come to rest.
    for (let i = 0; i < 40; i++) {
      const states = await Promise.all(settled.map(async (id) => (await get(`/api/payments/${id}`))?.state));
      if (states.every((s) => s && s !== "AWAITING_INBOUND" && s !== "INBOUND_DETECTED" && s !== "PAYOUT_REQUESTED")) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    const states = await Promise.all(settled.map(async (id) => (await get(`/api/payments/${id}`))?.state));
    ok("drove a spread of payments to rest", settled.length >= 3, `${settled.length} payments → ${states.join(", ")}`);
    ok("the mix includes at least one delivery", states.includes("DELIVERED"), states.join(", "));
    ok("the mix includes at least one payment parked for review", states.includes("MANUAL_REVIEW"), states.join(", "));

    const entries = await store().allEntries();
    ok("the ledger actually recorded postings", entries.length > 0, `${entries.length} entries`);

    /* ---- 1. DOUBLE ENTRY: every currency nets to zero ---- */
    const byCcy = new Map<string, number>();
    for (const e of entries) {
      const sign = e.direction === "debit" ? 1 : -1;
      byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0) + sign * e.amount);
    }
    for (const [ccy, net] of byCcy) {
      ok(`${ccy} nets to zero across the whole ledger`, Math.abs(net) < 1e-6, `net ${net}`);
    }

    /* ---- 2. NON-CUSTODY: no customer crypto rests with us ---- */
    for (const ccy of byCcy.keys()) {
      const bal = await store().balance("customer_wallet", ccy as any);
      ok(`customer_wallet holds no ${ccy} — conversion in flight, not custody`, Math.abs(bal) < 1e-9, String(bal));
    }

    /* ---- 3. EARMARKS: only payments in flight may hold one ---- */
    const heldBy = new Map<string, number>();
    for (const e of entries) {
      if (e.account !== "payout_float_XAF" || e.currency !== "XAF") continue;
      heldBy.set(e.paymentId, (heldBy.get(e.paymentId) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount));
    }
    const stranded: string[] = [];
    for (const [pid, net] of heldBy) {
      if (net >= 0) continue; // no earmark outstanding
      const st = (await store().getPayment(pid))?.state;
      if (st !== "PAYOUT_REQUESTED") stranded.push(`${pid}:${st}:${-net}`);
    }
    ok("no payment at rest is holding a float earmark", stranded.length === 0, stranded.join(", ") || "none");

    const floatAcct = await store().balance("payout_float_XAF", "XAF");
    ok("the earmark account is clear once nothing is in flight", Math.abs(floatAcct) < 1e-6, String(floatAcct));

    /* ---- 4. LIABILITIES are explicit and correctly signed ---- */
    for (const ccy of byCcy.keys()) {
      const rp = await store().balance("refund_payable", ccy as any);
      // Credit balances are negative here; a refund liability must never be a DEBIT
      // (that would read as money owed TO us by a sender we actually owe).
      ok(`refund_payable in ${ccy} is a liability or nil, never an asset`, rp <= 1e-9, String(rp));
    }

    /* ---- 5. No orphan postings ---- */
    const orphans: string[] = [];
    for (const pid of new Set(entries.map((e) => e.paymentId))) {
      if (pid.startsWith("pay_") || pid.startsWith("MMM")) {
        if (!(await store().getPayment(pid))) orphans.push(pid);
      }
    }
    ok("every posting belongs to a payment that exists", orphans.length === 0, orphans.join(", ") || "none");

    /* ---- 6. Fee revenue only ever accrues to us ---- */
    const fee = await store().balance("fee_revenue", "XAF");
    ok("fee revenue is a credit balance (earned, never negative)", fee <= 1e-9, String(fee));
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();

/* The four margin levers: a fee floor, partner rates on keys with monthly usage, cost-aware
   rail choice, realized FX on treasury sweeps.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/profitability.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { platformFee } = await import("../src/core/pricing.js");
  const { createApiKey, setApiKeyFee } = await import("../src/core/apiKeys.js");
  const { selectFundedAggregator } = await import("../src/core/routing.js");
  const payouts = await import("../src/adapters/payouts.js");
  const { realizedFx } = await import("../src/core/treasury.js");
  const { entriesFor } = await import("../src/core/ledger.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { "content-type": "application/json", "x-mm-sender": "profit-dev" };
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(`${root}${path}`, { headers: H, ...init, ...(init?.headers ? { headers: { ...H, ...(init.headers as Record<string, string>) } } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };

  try {
    console.log("\n1. The fee has a floor\n");
    ok("default floor is 100 XAF", getSettings().pricing.minFeeXaf === 100);
    ok("500 XAF: 2.5% would be 12 → the floor applies", platformFee(500) === 100);
    ok("10 000 XAF: 2.5% = 250 > floor", platformFee(10_000) === 250);
    let r = await j("/quotes", { method: "POST", body: JSON.stringify({ xaf: 500, method: "LIGHTNING", country: "CM" }) });
    ok("a quote at the minimum carries the floor, all-in total shown", r.body.feeXaf === 100 && r.body.totalXaf === 600, JSON.stringify({ fee: r.body.feeXaf, total: r.body.totalXaf }));
    updateSettings({ pricing: { ...getSettings().pricing, minFeeXaf: 0 } });
    ok("floor 0 → pure percentage again", platformFee(500) === 13);
    updateSettings({ pricing: { ...getSettings().pricing, minFeeXaf: 100 } });

    console.log("\n2. Partner rate on a key, and what the key did this month\n");
    const { key, secret } = createApiKey("Bank partner");
    const K = { "content-type": "application/json", authorization: `Bearer ${secret}` };
    r = await j("/quotes", { method: "POST", headers: K, body: JSON.stringify({ xaf: 10_000, method: "LIGHTNING", country: "CM" }) });
    ok("without a partner rate the key pays the public fee", r.body.feeXaf === 250);
    setApiKeyFee(key.id, 0.01);
    r = await j("/quotes", { method: "POST", headers: K, body: JSON.stringify({ xaf: 10_000, method: "LIGHTNING", country: "CM" }) });
    ok("with feePct 1% the key's quote carries 100 XAF", r.body.feeXaf === 100, String(r.body.feeXaf));
    const q = r.body;
    r = await j("/payments", { method: "POST", headers: K, body: JSON.stringify({ quoteId: q.id, recipient: { phone: "699000777", country: "CM", provider: "MTN" } }) });
    const pay = r.body;
    await fetch(`${root}/payments/${pay.id}/simulate`, { method: "POST", headers: K });
    for (let i = 0; i < 40; i++) { await new Promise((res) => setTimeout(res, 100)); const p = (await j(`/payments/${pay.id}`, { headers: K })).body; if (p.state === "DELIVERED") break; }
    ok("a device's quote is untouched by the partner rate", (await j("/quotes", { method: "POST", body: JSON.stringify({ xaf: 10_000, method: "LIGHTNING", country: "CM" }) })).body.feeXaf === 250);
    r = await j("/v1/payment-intents", { method: "POST", headers: K, body: JSON.stringify({ destination: "677000789", amount: 10_000 }) });
    r = await j(`/v1/payment-intents/${r.body.id}/routes`, { method: "POST", headers: K });
    ok("v1 routes for the key are quoted at the partner rate too", (r.body.routes as any[]).filter((x) => x.viable).every((x) => x.quote.platformFee === 100), String((r.body.routes as any[]).find((x) => x.viable)?.quote.platformFee));
    const admin = createUser("profit-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
    const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token, "content-type": "application/json" };
    r = await j("/admin/apikeys/usage", { headers: A });
    const u = (r.body.usage as any[]).find((x) => x.keyId === key.id);
    ok("monthly usage for the key: 1 delivered, volume and fee summed — the invoice basis", u && u.payments === 1 && u.delivered === 1 && u.volumeXaf === 10_000 && u.feeXaf === 100, JSON.stringify(u));
    const pr = await j(`/admin/apikeys/${key.id}`, { method: "PATCH", headers: A, body: JSON.stringify({ feePct: 0.5 }) });
    ok("changing a key's rate is a step-up operation like every key change (403 elevation_required)", pr.status === 403 && pr.body.error === "elevation_required", `${pr.status} ${pr.body.error}`);

    console.log("\n3. The cheaper funded rail wins\n");
    const base = { priority: 9, configured: () => true, live: () => false, supports: () => true, disburse: async () => ({ status: "accepted" as const, providerRef: "x", simulated: false }), queryStatus: async () => "PENDING" as const, statusByKey: () => null };
    const dear: payouts.PayoutAdapter = { ...base, name: "dear", balance: async () => 1_000_000, payoutFeePct: async () => 0.02 };
    const cheap: payouts.PayoutAdapter = { ...base, name: "cheap", balance: async () => 50_000, payoutFeePct: async () => 0.01 };
    const unknownFee: payouts.PayoutAdapter = { ...base, name: "unknownfee", balance: async () => 5_000_000 };
    payouts.PAYOUTS.push(dear, cheap, unknownFee);
    try {
      const pick = await selectFundedAggregator("MTN", "CM", 10_000, false);
      ok("among funded rails the lower fee wins, not the deeper balance", pick?.name === "cheap", pick?.name);
      ok("a rail whose fee is unknown ranks after any rail with a known fee", (await selectFundedAggregator("MTN", "CM", 40_000, false))?.name === "cheap");
      ok("…but only rails that can cover the amount are considered", (await selectFundedAggregator("MTN", "CM", 60_000, false))?.name === "dear");
    } finally { for (const a of [dear, cheap, unknownFee]) payouts.PAYOUTS.splice(payouts.PAYOUTS.indexOf(a), 1); }

    console.log("\n4. Realized FX on a treasury sweep\n");
    const treasury = await import("../src/core/treasury.js");
    // A sweep entry as withdraw() would record it (the rail is not configured in sandbox).
    const entry = { id: "tw_test1", at: new Date().toISOString(), rail: "lightning" as const, asset: "BTC" as const, amount: 0.01, destination: "x@y.com", by: "t", status: "sent" as const, referenceXaf: 360_000, customerXaf: 354_600 };
    (treasury.withdrawalHistory() as unknown as unknown[]); // ensure module loaded
    (treasury as unknown as { _push?: (e: unknown) => void })._push?.(entry);
    const { seedWithdrawal } = treasury as unknown as { seedWithdrawal?: (e: typeof entry) => void };
    if (seedWithdrawal) seedWithdrawal(entry);
    const res = await treasury.markSold("tw_test1", 358_000, "cfo");
    ok("marking a sweep sold records the realized XAF", res.ok && res.entry?.realizedXaf === 358_000, res.error);
    ok("…books crypto out of fx_position and XAF into the float through fx_pnl, each currency balanced", entriesFor("tw_test1").length === 4 && ["BTC", "XAF"].every((c) => Math.abs(entriesFor("tw_test1").filter((e) => e.currency === c).reduce((a, e) => a + (e.direction === "debit" ? e.amount : -e.amount), 0)) < 1e-9));
    const rf = realizedFx(0);
    ok("realized P&L = received − what customers paid: +3 400 XAF (0.96%)", rf.sweeps === 1 && rf.pnlXaf === 3_400 && rf.pnlPct != null && Math.abs(rf.pnlPct - 3_400 / 354_600) < 1e-9, JSON.stringify(rf));
    ok("a second mark is refused", !(await treasury.markSold("tw_test1", 1, "cfo")).ok);
    r = await j("/admin/revenue?period=30d", { headers: A });
    ok("the revenue report carries the realized block", r.status === 200 && r.body.realized?.sweeps === 1 && r.body.realized.pnlXaf === 3_400);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

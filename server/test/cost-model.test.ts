/* One cost model for every margin figure: invoice → contract → published → assumed; recorded
   at delivery; the capital diagnosis names the cause of a loss.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/cost-model.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { paymentCost } = await import("../src/core/pricing.js");
  const engine = await import("../src/core/capital/engine.js");
  const { store } = await import("../src/db/store.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { "content-type": "application/json", "x-mm-sender": "cost-test" };
  const j = async (p: string, init?: RequestInit) => { const r = await fetch(`${base}${p}`, init); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }; };
  try {
    console.log("\nCost model precedence\n");
    const P = { xaf: 10_000, totalXaf: 10_050, aggregator: "pawapay", recipient: { provider: "MTN" } } as const;
    let c = paymentCost(P);
    ok("nothing known → the assumption, and it says so", c.source === "assumed" && c.payout === Math.round(10_000 * getSettings().pricing.costs.payoutPct));
    c = paymentCost(P, 0.011);
    ok("a published rail figure beats the assumption", c.source === "published" && c.payout === 110);
    updateSettings({ pricing: { ...getSettings().pricing, contracts: { pawapay: { MTN: { pct: 0.012, fixedXaf: 10 } } } } });
    c = paymentCost(P, 0.011);
    ok("a contract beats the published figure", c.source === "contract" && c.payout === 130);
    c = paymentCost({ ...P, railCostXaf: 97, railCostSource: "invoice" }, 0.011);
    ok("an invoice recorded on the payment beats everything", c.source === "invoice" && c.payout === 97);
    ok("rail and fixed parts come from the same settings", c.rail === Math.round(10_050 * getSettings().pricing.costs.railPct) && c.total === 97 + c.rail + c.fixed);

    console.log("\nRecorded at delivery\n");
    const q = await j("/quotes", { method: "POST", headers: H, body: JSON.stringify({ xaf: 12_000, method: "LIGHTNING", country: "CM" }) });
    const p = await j("/payments", { method: "POST", headers: H, body: JSON.stringify({ quoteId: q.body.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Cost" } }) });
    await j(`/payments/${p.body.id}/simulate`, { method: "POST", headers: H, body: "{}" });
    let del = await store().getPayment(p.body.id);
    for (let i = 0; i < 40 && del?.state !== "DELIVERED"; i++) { await new Promise((r) => setTimeout(r, 250)); del = await store().getPayment(p.body.id); }
    ok("the delivered payment carries its rail cost and how it was known", del?.state === "DELIVERED" && typeof del.railCostXaf === "number" && !!del.railCostSource, `${del?.state} ${del?.railCostXaf} ${del?.railCostSource}`);
    ok("…on a sandbox rail without an invoice it is the contract/assumption, never a guess without a label", del?.railCostSource === "contract" || del?.railCostSource === "assumed" || del?.railCostSource === "published");

    console.log("\nDiagnosis\n");
    const completed = (await store().listPayments()).filter((x) => x.displayStatus === "Completed");
    let dg = engine.diagnose(completed);
    ok("revenue, cost and net reconcile", Math.abs(dg.revenue.total - dg.cost.total - dg.net) < 1 && dg.payments === completed.length, `${dg.revenue.total} − ${dg.cost.total} = ${dg.net}`);
    ok("cost is attributed by how it is known", Object.values(dg.cost.payoutBySource).reduce((a, s) => a + s.count, 0) === dg.payments);
    // Make the model lose: a 4 % assumed payout cost and a 300 XAF fixed cost.
    const saved = getSettings().pricing;
    updateSettings({ pricing: { ...saved, contracts: {}, costs: { payoutPct: 0.08, railPct: 0.001, fixedXaf: 500 } } });
    // Forget what was recorded at delivery so every payment falls back to the assumption.
    for (const x of completed) { x.railCostXaf = undefined; x.railCostSource = undefined; }
    dg = engine.diagnose(completed);
    ok("a loss is diagnosed, not just reported", dg.net < 0 && dg.findings[0].severity === "critical" && dg.findings.some((f) => /ASSUMPTION/.test(f.title)), dg.findings.map((f) => f.title).join(" | "));
    ok("the fixed-cost finding is named (here: no ticket size is profitable)", dg.findings.some((f) => f.title.startsWith("The fixed")), dg.findings.map((f) => f.title).join(" | "));
    ok("individual losers are listed with a reason", dg.losers.count > 0 && dg.losers.sample.every((l) => l.why.length > 0));
    (engine as unknown as { _resetCache?: () => void })._resetCache?.();
    const recs = await engine.scanRecommendations({});
    ok("the recommendation engine says FIX THE COST MODEL and REPRICE", recs.some((r) => r.type === "FIX_COST_MODEL") && recs.some((r) => r.type === "REPRICE"), recs.map((r) => r.type).join(","));
    updateSettings({ pricing: saved });
    dg = engine.diagnose(completed);
    ok("with the real settings restored the diagnosis is positive and explained", dg.net >= 0 && dg.findings.length >= 1);
    const rev = await engine.revenue({});
    ok("the capital revenue page carries the diagnosis", !!rev.diagnosis && rev.diagnosis.payments === dg.payments);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

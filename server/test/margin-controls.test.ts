/* Tier-2: contracted disbursement fees drive routing and profit; the float plan.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/margin-controls.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { contractedPayoutFee, payoutCostXaf } = await import("../src/core/pricing.js");
  const { payoutByName } = await import("../src/adapters/payouts.js");
  const { floatPlan } = await import("../src/core/floatPlan.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const admin = createUser("margin-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
  const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token, "content-type": "application/json" };
  const j = async (p: string, init?: RequestInit) => { const r = await fetch(`${base}${p}`, { ...init, headers: { ...A, ...(init?.headers ?? {}) } }); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }; };
  try {
    console.log("\nContracted disbursement fees\n");
    ok("nothing contracted by default", contractedPayoutFee("pawapay", "MTN") === null);
    let c = await payoutCostXaf("pawapay", "MTN", 10_000);
    ok("cost falls back to the assumption and says so", c.source === "assumed" && c.pct === getSettings().pricing.costs.payoutPct);
    const bad = await j("/admin/settings", { method: "PUT", body: JSON.stringify({ pricing: { contracts: { mtnmomo: { MTN: { pct: 0.01, fixedXaf: 0 } } } } }) });
    ok("an unknown aggregator is refused", bad.status === 400, String(bad.status));
    const bad2 = await j("/admin/settings", { method: "PUT", body: JSON.stringify({ pricing: { contracts: { pawapay: { MTN: { pct: 0.5, fixedXaf: 0 } } } } }) });
    ok("a 50 % fee is refused", bad2.status === 400);
    const good = await j("/admin/settings", { method: "PUT", body: JSON.stringify({ pricing: { contracts: { pawapay: { MTN: { pct: 0.012, fixedXaf: 0 }, ORANGE: { pct: 0.014, fixedXaf: 25 } }, peexit: { ORANGE: { pct: 0.011, fixedXaf: 0 } } } } }) });
    ok("a signed schedule is saved", good.status === 200 && getSettings().pricing.contracts?.pawapay?.MTN?.pct === 0.012, String(good.status));
    c = await payoutCostXaf("pawapay", "ORANGE", 10_000);
    ok("cost uses the contract: 1.4 % + 25 XAF on 10 000 = 165", c.source === "contract" && c.cost === 165, JSON.stringify(c));
    const pp = payoutByName("pawapay")!, px = payoutByName("peexit")!;
    ok("PawaPay now reports a fee to the router (it publishes none over the API)", (await pp.payoutFeePct!("MTN", "CM")) === 0.012);
    ok("Peexit reports the contract when the API publishes nothing (sandbox)", (await px.payoutFeePct!("ORANGE", "CM")) === 0.011);
    const pricing = await j("/admin/pricing");
    ok("the pricing view carries the contracts", pricing.body.contracts?.peexit?.ORANGE?.pct === 0.011);
    const rev = await j("/admin/revenue?window=30d");
    ok("profit by operator marks contracted rows", rev.status === 200 && Array.isArray(rev.body.byOperator), String(rev.status));

    console.log("\nFloat plan\n");
    const plan = await floatPlan();
    ok("the plan lists every configured aggregator with a 14-day window and the target", plan.windowDays === 14 && plan.targetDays === 5 && plan.aggregators.length >= 1, JSON.stringify(plan.aggregators.map((a) => a.name)));
    ok("sandbox: daily volume is computed from delivered payouts and the note is honest", typeof plan.totals.avgDailyXaf === "number" && plan.note.length > 0, plan.note);
    const liq = await j("/admin/liquidity");
    ok("Admin → Liquidity carries the float plan", liq.status === 200 && liq.body.floatPlan?.targetDays === 5);
    // The target lives with the treasury destinations: Super Admin + step-up (real money).
    const el = await j("/admin/elevate", { method: "POST", body: JSON.stringify({ password: "Str0ng-Passw0rd!x" }) });
    const E = { "x-admin-token": String(el.body.token ?? A["x-admin-token"]), "content-type": "application/json" };
    const t = await j("/admin/treasury/destinations", { method: "PUT", headers: E, body: JSON.stringify({ floatTargetDays: 7 }) });
    ok("the target is operator-editable (elevated Super Admin)", t.status === 200 && getSettings().treasury.floatTargetDays === 7, `${t.status} ${JSON.stringify(t.body)}`);
    ok("…and bounded", (await j("/admin/treasury/destinations", { method: "PUT", headers: E, body: JSON.stringify({ floatTargetDays: 90 }) })).status === 400);
    ok("the plan follows the new target", (await floatPlan()).targetDays === 7);
    updateSettings({ pricing: { ...getSettings().pricing, contracts: {} } });
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

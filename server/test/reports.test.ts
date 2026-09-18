/* Reports: gross revenue (fees + spread), rolling windows with a previous-window comparison,
   the funnel (conversion vs reliability), per-method and per-provider rows, and role access.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/reports.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const { getSettings } = await import("../src/core/settings.js");
  const { store } = await import("../src/db/store.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tok = (role: string) => ({ "x-admin-token": issueToken({ uid: createUser(`rep-${role.replace(/\s/g, "")}`, "Str0ng-Passw0rd!x", role as never).id, role: role as never }).token, "content-type": "application/json" });
  const A = tok("Super Admin");
  const j = async (p: string, headers = A) => { const r = await fetch(`${base}${p}`, { headers }); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }; };
  try {
    console.log("\nWindows and comparison\n");
    let d = (await j("/admin/reports?period=month")).body;
    ok("the window is named and dated, not implied", d.period?.key === "month" && d.period.days === 30 && !!d.period.from && !!d.period.to, JSON.stringify(d.period));
    ok("a previous window of equal length is reported beside it", !!d.previous && typeof d.previous.volumeXaf === "number");
    const q = (await j("/admin/reports?period=quarter")).body;
    ok("90 days is available (it was today/week/month only)", q.period.days === 90);
    ok("an unknown period falls back to 30 days", (await j("/admin/reports?period=nonsense")).body.period.days === 30);

    console.log("\nRevenue definition\n");
    const pr = getSettings().pricing;
    const completed = (await store().listPayments()).filter((p) => p.displayStatus === "Completed" && Date.now() - Date.parse(p.createdAt) < 30 * 86_400_000);
    const spread = completed.reduce((s, p) => { const b = typeof p.spreadBps === "number" ? p.spreadBps : pr.spreadBps[p.method]; return s + (b > 0 && b < 10_000 ? Math.round((p.totalXaf * b) / (10_000 - b)) : 0); }, 0);
    const fees = completed.reduce((s, p) => s + p.feeXaf, 0);
    ok("revenue is fees PLUS the FX spread — the same figure Rates & Pricing reports", d.revenueXaf === fees + spread && d.feeXaf === fees && d.spreadXaf === spread, `${d.revenueXaf} = ${fees} + ${spread}`);
    ok("the daily series carries revenue, not just volume", d.daily.every((x: any) => typeof x.revenueXaf === "number"));
    ok("daily volume sums to the headline volume", d.daily.reduce((s: number, x: any) => s + x.volumeXaf, 0) === d.volumeXaf);

    console.log("\nFunnel and breakdowns\n");
    const f = d.funnel;
    ok("the funnel reconciles: created = paid + expired + waiting + held", f.created === f.paid + f.unpaidExpired + f.unpaidOpen + f.unpaidHeld, JSON.stringify(f));
    ok("paid = delivered + failed-after-payment + in flight", f.paid === f.delivered + f.failedAfterPayment + f.inFlight);
    ok("conversion and reliability are separate rates", f.conversionPct != null && f.reliabilityPct != null && f.conversionPct <= 100 && f.reliabilityPct <= 100, `${f.conversionPct}% / ${f.reliabilityPct}%`);
    ok("the drop-off carries the volume that was never sent", typeof f.lostVolumeXaf === "number" && (f.unpaidExpired === 0 || f.lostVolumeXaf > 0));
    ok("invoice validity per method is reported beside the median time to expiry", Object.keys(f.invoiceTtlMin).length >= 3);
    ok("per-method rows reconcile with the funnel", d.byMethod.reduce((s: number, m: any) => s + m.attempts, 0) === f.created && d.byMethod.reduce((s: number, m: any) => s + m.delivered, 0) === f.delivered, JSON.stringify(d.byMethod.map((m: any) => [m.method, m.attempts, m.delivered])));
    ok("per-provider rows carry attempts, paid, conversion and reliability", d.byProvider.every((p: any) => typeof p.attempts === "number" && typeof p.paid === "number" && "conversionPct" in p && "reliabilityPct" in p));
    ok("delivered per provider sums to the headline payments", d.byProvider.reduce((s: number, p: any) => s + p.payments, 0) === d.payments);

    console.log("\nAccess\n");
    ok("Finance Manager can read reports", (await j("/admin/reports", tok("Finance Manager"))).status === 200);
    ok("Read Only can read reports", (await j("/admin/reports", tok("Read Only"))).status === 200);
    ok("Support Agent cannot", (await j("/admin/reports", tok("Support Agent"))).status === 403);
    ok("Compliance Officer cannot", (await j("/admin/reports", tok("Compliance Officer"))).status === 403);
    ok("an unauthenticated request cannot", (await fetch(`${base}/admin/reports`)).status === 401);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

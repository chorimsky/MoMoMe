/* /ops/snapshot must DERIVE every figure.

   It previously reported fabricated numbers while every /admin/* view had already been
   moved to real data:
     • floatXaf = max(0, payout_float_XAF) + 48_500_000 — payout_float_XAF is a CREDIT
       balance so it is always ≤ 0, making max(0, …) always 0 and the treasury a hardcoded
       48.5M regardless of reality;
     • deliveredToday / failedToday counted ALL time, not today;
     • every rail was healthy:true with invented latencies (900/1200/2600ms).
   An ops dashboard that invents its numbers is worse than one that admits it does not know,
   because capacity and incident decisions get made on it. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const J = { "content-type": "application/json" };
  try {
    console.log("\n/ops/snapshot — derived, not invented");
    let r = await fetch(`${base}/api/ops/snapshot`);
    ok("unauthenticated → 401", r.status === 401, String(r.status));

    const lr = await fetch(`${base}/api/admin/login`, { method: "POST", headers: J, body: JSON.stringify({ username: "admin", password: "momome-admin" }) });
    const { token } = (await lr.json()) as { token: string };
    r = await fetch(`${base}/api/ops/snapshot`, { headers: { authorization: `Bearer ${token}` } });
    const s = (await r.json()) as {
      floatXaf: number; deliveredToday: number; failedToday: number; inFlight: number;
      rails: Array<{ method: string; healthy: boolean; latencyMs: number }>;
    };
    ok("authenticated → 200", r.status === 200, String(r.status));

    // The specific fabricated constant must be gone.
    ok("floatXaf is not the hardcoded 48,500,000", s.floatXaf !== 48_500_000, String(s.floatXaf));
    ok("floatXaf is a real number ≥ 0", Number.isFinite(s.floatXaf) && s.floatXaf >= 0, String(s.floatXaf));

    // Latencies must come from measured deliveries, not the 900/1200/2600 placeholders.
    const invented = new Set([900, 1200, 2600]);
    ok("no invented rail latencies", s.rails.every((x) => !invented.has(x.latencyMs)), s.rails.map((x) => `${x.method}=${x.latencyMs}`).join(" "));
    ok("latency is 0 when there is nothing to measure", s.rails.every((x) => x.latencyMs >= 0));
    ok("a rail with no failures reads healthy", s.rails.every((x) => x.healthy === true));

    // "Today" must actually mean today. The seeded demo data spans earlier days, so an
    // all-time count and a today count differ — that difference is the assertion.
    const all = (await (await fetch(`${base}/api/admin/payments`, { headers: { authorization: `Bearer ${token}` } })).json()) as Array<{ displayStatus: string; updatedAt: string }>;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const doneToday = all.filter((p) => p.displayStatus === "Completed" && Date.parse(p.updatedAt) >= start.getTime()).length;
    ok("deliveredToday counts only today", s.deliveredToday === doneToday, `${s.deliveredToday} vs ${doneToday}`);
    ok("deliveredToday never exceeds the all-time total",
       s.deliveredToday <= all.filter((p) => p.displayStatus === "Completed").length);
  } finally { server.close(); }
  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

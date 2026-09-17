/* Tier-1 operations: the deep health probe, paging alerts, process roles.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/ops-readiness.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { reconcileTick, jobsHealth, processRole, runsJobs, servesHttp } = await import("../src/jobs.js");
  const alerts = await import("../src/core/alerts.js");
  const { listNotifications } = await import("../src/core/notifications.js");
  const { updateSettings } = await import("../src/core/settings.js");
  const store = (await import("../src/core/store.js"));
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const j = async (p: string) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
  try {
    console.log("\nProcess roles\n");
    ok("default role is `all`: serves HTTP and runs jobs", processRole() === "all" && runsJobs() && servesHttp());

    console.log("\nDeep health\n");
    let h = await j("/health/deep");
    ok("before the first tick the probe is 503: money jobs have not run", h.status === 503 && h.body.problems.some((p: string) => /money jobs/.test(p)), `${h.status} ${JSON.stringify(h.body.problems)}`);
    await reconcileTick();
    h = await j("/health/deep");
    ok("after a tick it is 200 with store, jobs, fx and rails sections", h.status === 200 && h.body.ok === true && h.body.store?.durable !== undefined && h.body.jobs.lastTickAt && Array.isArray(h.body.rails), `${h.status} ${JSON.stringify(h.body.problems)}`);
    ok("the plain /health stays a cheap liveness check", (await j("/health")).body.ok === true);
    ok("jobsHealth reports the tick", jobsHealth().lastTickAt !== null && !jobsHealth().stale);

    console.log("\nPaging alerts\n");
    alerts.resetAlerts();
    updateSettings({ ops: { acceptingPayments: true, payoutApprovalXaf: 5_000_000, alertPhone: "237677000999" } });
    let ev = await alerts.evaluateAlerts();
    // The sandbox seed carries an old MANUAL_REVIEW payment — a real condition, so it pages.
    ok("the seeded sandbox raises only the long-held review", ev.raised.every((k) => k === "payments:review") && ev.active.length === ev.raised.length, JSON.stringify(ev.raised));
    const baseline = ev.active.length;
    // A payout stuck in PAYOUT_REQUESTED for 25 minutes.
    const p = [...store.payments.values()][0];
    ok("a seeded payment exists to age", !!p);
    const savedState = p.state, savedAt = p.updatedAt;
    p.state = "PAYOUT_REQUESTED"; p.updatedAt = new Date(Date.now() - 25 * 60_000).toISOString();
    ev = await alerts.evaluateAlerts();
    ok("a payout stuck for over 20 min pages the operator once", ev.raised.includes("payments:stuck") && ev.active.length === baseline + 1, JSON.stringify(ev.raised));
    const notes = listNotifications(50).filter((n) => n.audience === "operator" && /PAYOUT_REQUESTED/.test(n.body));
    ok("…and it is on record in the outbox", notes.length >= 1);
    const again = await alerts.evaluateAlerts();
    ok("evaluating again within the hour does not page again", again.raised.length === 0 && again.active.find((a) => a.key === "payments:stuck")!.count === 1);
    const later = await alerts.evaluateAlerts(Date.now() + 61 * 60_000);
    ok("after an hour it reminds (count 2)", later.active.find((a) => a.key === "payments:stuck")?.count === 2, JSON.stringify(later.active.map((a) => [a.key, a.count])));
    p.state = savedState; p.updatedAt = savedAt;
    const cleared = await alerts.evaluateAlerts();
    ok("when the condition clears, an all-clear goes out and it leaves the active list", cleared.cleared.includes("payments:stuck") && !cleared.active.some((a) => a.key === "payments:stuck"));
    h = await j("/health/deep");
    ok("the deep probe lists open alerts by key and is still 200 for a warning-only state", h.status === 200 && h.body.alerts.every((a: any) => a.key !== "payments:stuck"));
    const network = (await import("../src/core/network/saga.js"));
    ok("network reconciliation feeds the alert list (none unmatched now)", (await alerts.conditions()).every((c) => !c.key.startsWith("network:")) && !!network);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

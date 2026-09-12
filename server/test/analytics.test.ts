/* Product analytics — anonymous in, answers out.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/analytics.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { ingest, report, countryOfTz } = await import("../src/core/analytics.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const tokenFor = (role: string) => { const u = createUser(`t-${role.replace(/\s/g, "").toLowerCase()}`, "Str0ng-Passw0rd!x", role as never); return issueToken({ uid: u.id, role: role as never }).token; };
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const now = Date.now();
  const H = { "content-type": "application/json" };

  try {
    console.log("\nIngest — only the anonymous shape is accepted\n");
    const vid = "visitor_aaaaaaaaaaaa", sid = "session_bbbbbbbbbbbb";
    let r = await fetch(`${root}/telemetry`, { method: "POST", headers: H, body: JSON.stringify({ p: "web", vid, sid, tz: "Africa/Douala", lang: "fr", ver: "web-android", scr: "phone", ref: "wa.me", events: [
      { type: "session_start", name: "session", t: now - 90_000 },
      { type: "view", name: "/", t: now - 90_000 },
      { type: "view", name: "/send", t: now - 60_000 },
      { type: "action", name: "send_step", t: now - 60_000, props: { step: "details" } },
      { type: "action", name: "send_step", t: now - 40_000, props: { step: "method" } },
      { type: "action", name: "method_chosen", t: now - 35_000, props: { method: "LIGHTNING", phone: "677000789xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } },
      { type: "session_end", name: "session", t: now - 10_000, dur: 80 },
    ] }) });
    const b = await r.json() as { accepted: number };
    ok("a well-formed batch is accepted (202) with every event counted", r.status === 202 && b.accepted === 7, `${r.status} ${b.accepted}`);
    ok("a batch without ids, or with a strange platform, is dropped whole", ingest({ p: "web", events: [{ type: "view", name: "/" }] }) === 0 && ingest({ p: "tv", vid, sid, events: [{ type: "view", name: "/" }] }) === 0);
    ok("unknown event types are skipped, the rest kept", ingest({ p: "ios", vid: "v2xxxxxxxxxx", sid: "s2xxxxxxxxxx", events: [{ type: "hack", name: "x" }, { type: "view", name: "/pay/:code" }] }) === 1);
    ok("a stamp far in the past is replaced by server time (queued lies are not history)", (() => { ingest({ p: "ios", vid: "v3xxxxxxxxxx", sid: "s3xxxxxxxxxx", events: [{ type: "view", name: "/old", t: now - 86_400_000 * 30 }] }); return report(1, now).pages.some((p) => p.path === "/old"); })());
    ok("timezone → country, unknown stays honest", countryOfTz("Africa/Douala") === "CM" && countryOfTz("Europe/Paris") === "FR" && countryOfTz("Mars/Olympus") === "??");

    console.log("\nReport — the operator's questions\n");
    // a second, older visitor on Android who bounced; and a returning one
    ingest({ p: "android", vid: "v4xxxxxxxxxx", sid: "s4xxxxxxxxxx", tz: "Europe/Paris", lang: "fr", ver: "1.1.0", scr: "phone", events: [{ type: "view", name: "/" , t: now - 5000 }] }, now);
    const rep = report(7, now);
    ok("sessions and people are counted", rep.totals.sessions >= 4 && rep.totals.visitors >= 4, `${rep.totals.sessions} sessions ${rep.totals.visitors} people`);
    ok("session length uses the client's own duration when longer", rep.totals.sessionSec.p90 >= 80);
    const web = rep.platforms.find((p) => p.platform === "web")!;
    ok("platform split: web session with its median time", web.sessions === 1 && web.sessionSecP50 === 80, JSON.stringify(web));
    ok("countries from timezones: Cameroon and France present", rep.countries.some((c) => c.country === "CM") && rep.countries.some((c) => c.country === "FR"));
    const send = rep.pages.find((p) => p.path === "/send")!;
    ok("time on page from the gap to the next view / session end", rep.pages.find((p) => p.path === "/")?.avgSec === 30 && send.avgSec === 50, `/ ${rep.pages.find((p) => p.path === "/")?.avgSec} /send ${send?.avgSec}`);
    ok("entries and exits per page", rep.pages.find((p) => p.path === "/")!.entries >= 2 && send.exits === 1);
    ok("the send funnel counts sessions reaching each step", rep.funnel[0].sessions === 1 && rep.funnel[1].sessions === 1 && rep.funnel[2].sessions === 0 && rep.funnel[1].ofPrevious === 1);
    const mc = rep.actions.find((a) => a.name === "method_chosen")!;
    ok("actions with their most common value; long prop values are cut", mc.top?.[0].value === "LIGHTNING" && mc.count === 1);
    ok("bounce: one page, nothing done", rep.totals.bounce > 0 && rep.totals.bounce < 1, String(rep.totals.bounce));
    ok("hour-of-day and day series have the right shape", rep.byHour.length === 24 && rep.byDay.length === 7 && rep.byDay.at(-1)!.sessions >= 4);
    ok("referrers only when the client sent one", rep.referrers.some((x) => x.ref === "wa.me"));

    console.log("\nAccess — the report is an admin section\n");
    r = await fetch(`${root}/admin/analytics?days=7`);
    ok("no session → 401", r.status === 401);
    r = await fetch(`${root}/admin/analytics?days=7`, { headers: { "x-admin-token": tokenFor("Super Admin") } });
    ok("a Super Admin sees it", r.status === 200 && (await r.json() as { totals: unknown }).totals !== undefined, String(r.status));
    r = await fetch(`${root}/admin/analytics?days=7`, { headers: { "x-admin-token": tokenFor("Support Agent") } });
    ok("a Support Agent does not (403)", r.status === 403, String(r.status));
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

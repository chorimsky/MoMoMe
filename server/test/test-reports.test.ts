/* Tester programme: a run filed from momome.xyz/test must name the tester, must only carry
   cases the shared list knows, and must reach the operator: in Admin → Testing (gated by
   role) and as an operator notification. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "test-reports-secret";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  const { createApp } = await import("../src/app.js");
  const { TEST_CASES } = await import("../../shared/testing.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const J = { "content-type": "application/json" };
  const post = (p: string, b: unknown, h: Record<string, string> = {}) => fetch(`${base}${p}`, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
  const login = async (username: string, password: string) => {
    const r = await post("/api/admin/login", { username, password });
    return r.ok ? ((await r.json()) as { token: string }).token : null;
  };

  try {
    console.log("\nTester programme");
    const good = {
      testerId: "browser-abcdef123456", name: "Aminatou Bello", phone: "677000118", country: "CM", platform: "android",
      device: "Pixel 7a, Android 14", build: "1.0.0", lang: "fr",
      results: [
        { caseId: "1", outcome: "pass" }, { caseId: "2", outcome: "pass" },
        { caseId: "11", outcome: "fail", note: "Save button hidden behind keyboard" },
        { caseId: "13", outcome: "skip" },
        { caseId: "999", outcome: "fail", note: "not a real case" },
        { caseId: "1", outcome: "fail" }, // duplicate: last answer wins
      ],
    };

    let r = await post("/api/testing/report", { ...good, name: "A" });
    ok("name shorter than 2 chars → 400 bad_name", r.status === 400 && ((await r.json()) as { error: string }).error === "bad_name");
    r = await post("/api/testing/report", { ...good, phone: "12345" });
    ok("invalid phone → 400 bad_phone", r.status === 400 && ((await r.json()) as { error: string }).error === "bad_phone");
    r = await post("/api/testing/report", { ...good, platform: "windows" });
    ok("unknown platform → 400", r.status === 400);
    r = await post("/api/testing/report", { ...good, results: [{ caseId: "999", outcome: "pass" }] });
    ok("only unknown cases → 400 no_results", r.status === 400 && ((await r.json()) as { error: string }).error === "no_results");
    r = await post("/api/testing/report", { ...good, testerId: "x" });
    ok("malformed testerId → 400", r.status === 400);

    r = await post("/api/testing/report", good);
    const filed = (await r.json()) as { ok: boolean; ref: string; passed: number; failed: number; skipped: number };
    ok("valid report → 200 with TR- reference", r.status === 200 && /^TR-[A-Z2-9]{6}$/.test(filed.ref), filed.ref);
    ok("unknown case dropped, duplicate keeps last: 1 pass, 2 fail, 1 skip", filed.passed === 1 && filed.failed === 2 && filed.skipped === 1, `${filed.passed}/${filed.failed}/${filed.skipped}`);

    // A second run by the same tester on web: kept as its own report.
    r = await post("/api/testing/report", { ...good, platform: "web", results: [{ caseId: "3", outcome: "pass" }] });
    ok("second run by same tester is filed", r.status === 200);

    r = await fetch(`${base}/api/admin/testing/reports`);
    ok("admin list unauthenticated → 401", r.status === 401, String(r.status));

    const token = await login("admin", "momome-admin");
    ok("admin login", !!token);
    r = await fetch(`${base}/api/admin/testing/reports`, { headers: { authorization: `Bearer ${token}` } });
    const list = (await r.json()) as { total: number; testers: number; items: Array<{ ref: string; name: string; phone: string; testerId: string; results: Array<{ caseId: string; outcome: string; note?: string }> }>; cases: Array<{ id: string }> };
    ok("admin sees both runs from one tester", r.status === 200 && list.total === 2 && list.testers === 1, `${list.total}/${list.testers}`);
    ok("tester is identifiable: name + canonical phone", list.items.every((i) => i.name === "Aminatou Bello" && i.phone === "677000118"));
    const first = list.items.find((i) => i.ref === filed.ref)!;
    ok("note survives, unknown case gone", first.results.some((x) => x.caseId === "11" && x.note === "Save button hidden behind keyboard") && !first.results.some((x) => x.caseId === "999"));
    ok("case list shipped for titles", list.cases.length === TEST_CASES.length);

    r = await fetch(`${base}/api/admin/notifications/outbox`, { headers: { authorization: `Bearer ${token}` } });
    const notes = (await r.json()) as { items?: Array<{ kind: string; body: string }> } | Array<{ kind: string; body: string }>;
    const arr = Array.isArray(notes) ? notes : (notes.items ?? []);
    const mine = arr.find((n) => n.kind === "test_report" && n.body.includes(filed.ref));
    ok("operator notified with the failures named", !!mine && mine.body.includes("Aminatou Bello") && mine.body.includes("11 Keyboard"), mine?.body.slice(0, 90));
  } finally {
    server.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

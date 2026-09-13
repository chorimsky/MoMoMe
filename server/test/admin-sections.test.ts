/* Every /admin route must map to a section — the gate fails closed, so an unmapped route
   answers 403 even to a Super Admin (that is how /admin/methods and /admin/deletion-requests
   went dark). This enumerates the router's admin routes and calls each as a Super Admin.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/admin-sections.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { api } = await import("../src/routes/api.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const admin = createUser("sections-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
  const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token };
  const agent = createUser("sections-agent", "Str0ng-Passw0rd!x", "Support Agent" as never);
  const S = { "x-admin-token": issueToken({ uid: agent.id, role: "Support Agent" as never }).token };

  type Layer = { route?: { path: string; methods: Record<string, boolean> } };
  const stack = (api as unknown as { stack: Layer[] }).stack;
  const gets = stack.filter((l) => l.route && l.route.methods.get && l.route.path.startsWith("/admin/")).map((l) => l.route!.path);
  const prefixes = [...new Set(gets.map((p) => p.split("/")[2]))].sort();
  console.log(`\n${gets.length} admin GET routes across ${prefixes.length} prefixes\n`);
  try {
    // One representative GET per prefix, with ids filled in: anything but "forbidden" is a
    // mapped route (200, 400, 404 all mean the gate let a Super Admin through).
    for (const prefix of prefixes) {
      const path = gets.find((p) => p.split("/")[2] === prefix)!.replace(/:[a-zA-Z]+/g, "x").replace(/\?$/, "");
      const r = await fetch(`${root}${path}`, { headers: A });
      const body = await r.json().catch(() => ({})) as { error?: string };
      ok(`/admin/${prefix} is mapped to a section (${path} → ${r.status})`, !(r.status === 403 && body.error === "forbidden"), body.error ?? "");
    }
    // The other direction: a Support Agent is refused where their role has no section.
    for (const p of ["liquidity", "pricing", "analytics", "settings", "treasury", "apikeys"]) {
      const r = await fetch(`${root}/admin/${p}`, { headers: S });
      ok(`a Support Agent is refused /admin/${p}`, r.status === 403);
    }
    for (const p of ["overview", "payments", "customers"]) {
      const r = await fetch(`${root}/admin/${p}`, { headers: S });
      ok(`…and may read /admin/${p}`, r.status === 200, String(r.status));
    }
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

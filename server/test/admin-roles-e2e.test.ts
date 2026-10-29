/* Every role, against every section it may and may not reach.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/admin-roles-e2e.test.ts

   ROLE_SECTIONS declares who may see what. Nothing checked that the running server agrees
   with it. admin-sections.test.ts calls one GET per prefix as a Super Admin — it proves a
   route is mapped, not that a Support Agent is kept out of Settings. admin-stepup covers
   re-authentication for sensitive writes, which is a different question again.

   Safety: ALLOWED cases are exercised with GET. DENIED cases may use any method, because
   the guard refuses before the handler runs — nothing executes and no money moves. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "admin-roles-e2e";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { api, sectionForPath } = await import("../src/routes/api.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const { ADMIN_ROLES, canAccess, isSuperAdmin, isReadOnly } = await import("../../shared/roles.js");

  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const tokenFor = (role: string) => {
    const u = createUser(`e2e-${role.replace(/\s+/g, "-").toLowerCase()}`, "Str0ng-Passw0rd!x", role as never);
    return issueToken({ uid: u.id, role: role as never }).token;
  };
  const tokens = Object.fromEntries(ADMIN_ROLES.map((r) => [r, tokenFor(r)])) as Record<string, string>;
  const call = async (token: string, method: string, path: string) => {
    const r = await fetch(`${root}${path}`, { method, headers: { "x-admin-token": token, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) });
    return r.status;
  };

  // One representative GET per section, with :params filled in.
  const sub = (p: string) => p.replace(/^\/admin/, "");
  const getBySection = new Map<string, string>();
  for (const l of (api as unknown as { stack: Layer[] }).stack) {
    const p = l.route?.path;
    if (!p?.startsWith("/admin/") || !l.route?.methods.get) continue;
    // Skip routes that carry a STRICTER per-route rule than their section. /users and
    // /apikeys are Super-Admin-only wherever they sit, so they say nothing about whether a
    // role may reach the section around them — picking /admin/users as the representative
    // for "administration" made Read Only look wrongly denied, when in fact it reaches
    // /admin/audit in that same section perfectly well. Those stricter rules are asserted
    // directly under "Privilege escalation" below.
    if (/^\/(users|apikeys|readiness)(\/|$)/.test(sub(p))) continue;
    const s = sectionForPath(sub(p));
    if (s && !getBySection.has(s)) getBySection.set(s, p.replace(/:[a-zA-Z]+/g, "x").replace(/\?$/, ""));
  }
  console.log(`\n${ADMIN_ROLES.length} roles × ${getBySection.size} sections\n`);
  ok("sections with a representative route were found", getBySection.size > 12, `${getBySection.size}`);

  console.log("\nEvery role sees exactly the sections it is granted\n");
  let wrongAllow = 0, wrongDeny = 0;
  const detail: string[] = [];
  for (const role of ADMIN_ROLES) {
    for (const [section, path] of getBySection) {
      const allowed = canAccess(role, section as never);
      const status = await call(tokens[role], "GET", path);
      // 403 is the ONLY refusal that means "your role may not". 404/400/500 mean the guard
      // let the request through to a handler, which is what "allowed" asserts.
      const refused = status === 403;
      if (allowed && refused) { wrongAllow++; detail.push(`${role} DENIED ${section} (${path})`); }
      if (!allowed && !refused) { wrongDeny++; detail.push(`${role} ALLOWED ${section} → ${status} (${path})`); }
    }
  }
  ok("no role is refused a section it is granted", wrongAllow === 0, detail.filter((d) => d.includes("DENIED")).slice(0, 4).join(" | ") || "none");
  ok("no role reaches a section it is not granted", wrongDeny === 0, detail.filter((d) => d.includes("ALLOWED")).slice(0, 4).join(" | ") || "none");

  console.log("\nPrivilege escalation is refused\n");
  for (const role of ADMIN_ROLES.filter((r) => !isSuperAdmin(r))) {
    const s1 = await call(tokens[role], "GET", "/admin/users");
    ok(`${role} cannot list admin users`, s1 === 403, `HTTP ${s1}`);
  }
  for (const role of ADMIN_ROLES.filter((r) => !isSuperAdmin(r)).slice(0, 3)) {
    const s2 = await call(tokens[role], "POST", "/admin/users");
    ok(`${role} cannot create an admin user`, s2 === 403, `HTTP ${s2}`);
    const s3 = await call(tokens[role], "GET", "/admin/apikeys");
    ok(`${role} cannot read partner API keys`, s3 === 403, `HTTP ${s3}`);
  }

  console.log("\nAccess is layered: a section grant, and stricter rules on single routes\n");
  // The two must both hold, and they are genuinely different rules. Collapsing them —
  // making the whole `administration` section Super-Admin-only — would have taken the
  // audit log away from every read-only reviewer.
  const roTok = tokens["Read Only"];
  ok("Read Only reaches /admin/audit — the section grant works", (await call(roTok, "GET", "/admin/audit")) !== 403);
  ok("…but not /admin/users — the stricter route rule works", (await call(roTok, "GET", "/admin/users")) === 403);
  // Three routes carry a rule stricter than their section, each enforced somewhere
  // different: /users and /apikeys in the guard, /readiness inside its own handler.
  ok("…nor /admin/readiness — Super Admin only, checked in the route", (await call(roTok, "GET", "/admin/readiness")) === 403);
  ok("a Super Admin reaches all three", (await call(tokens["Super Admin"], "GET", "/admin/users")) !== 403
    && (await call(tokens["Super Admin"], "GET", "/admin/readiness")) !== 403
    && (await call(tokens["Super Admin"], "GET", "/admin/apikeys")) !== 403);

  console.log("\nRead Only sees everything and changes nothing\n");
  const ro = ADMIN_ROLES.find((r) => isReadOnly(r))!;
  const roGet = await call(tokens[ro], "GET", getBySection.get("payments") ?? "/admin/payments");
  ok("Read Only can read", roGet !== 403, `HTTP ${roGet}`);
  for (const [method, path] of [["POST", "/admin/settings"], ["PUT", "/admin/settings"], ["POST", "/admin/rails/egress/recheck"]] as const) {
    const s = await call(tokens[ro], method, path);
    ok(`Read Only cannot ${method} ${path}`, s === 403, `HTTP ${s}`);
  }
  // The documented exception: anyone may change their OWN password.
  const roPw = await call(tokens[ro], "POST", "/admin/password");
  ok("…but may still change their own password", roPw !== 403, `HTTP ${roPw}`);

  console.log("\nA token is only as good as its signature\n");
  const bad = tokens["Support Agent"].slice(0, -2) + "xy";
  ok("a tampered token is rejected", (await call(bad, "GET", "/admin/payments")) === 401, "401 expected");
  ok("no token is rejected", (await (await fetch(`${root}/admin/payments`)).status) === 401, "401 expected");

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

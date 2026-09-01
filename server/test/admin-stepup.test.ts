/* Step-up authentication + the go-live readiness console, over real HTTP.

   A 12h admin session is a standing authorisation: a walked-away laptop or a token lifted
   from localStorage can otherwise sweep the treasury or grant itself a role. Role checks
   do not help — a stolen Super-Admin token passes them. Elevation requires proof the
   operator re-entered their password within the last few minutes, for exactly the
   operations an attacker would want. */
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
  const { createUser } = await import("../src/core/adminUsers.js");
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const J = { "content-type": "application/json" };
  const login = async (u: string, p: string) => {
    const r = await fetch(`${base}/api/admin/login`, { method: "POST", headers: J, body: JSON.stringify({ username: u, password: p }) });
    return r.ok ? ((await r.json()) as { token: string }).token : null;
  };

  try {
    console.log("\nStep-up authentication");
    const token = await login("admin", "momome-admin");
    ok("super-admin signed in", !!token);
    let A = { ...J, authorization: `Bearer ${token}` };

    // An ordinary session must NOT be able to move money or change access.
    const guarded: Array<[string, string, unknown]> = [
      ["PUT", "/api/admin/rails/egress", { allowlistedIp: "1.2.3.4" }],
      ["POST", "/api/admin/treasury/withdraw", { rail: "lightning", amount: 1 }],
      ["POST", "/api/admin/momo/cashout", { phone: "677000789", amount: 100 }],
      ["POST", "/api/admin/users", { username: "mallory", password: "Passw0rd!x", role: "Read Only" }],
      ["POST", "/api/admin/apikeys", { label: "k" }],
    ];
    for (const [m, path, body] of guarded) {
      const r = await fetch(`${base}${path}`, { method: m, headers: A, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      ok(`un-elevated ${m} ${path.replace("/api/admin", "")} → 403 elevation_required`,
         r.status === 403 && j.error === "elevation_required", `${r.status} ${j.error ?? ""}`);
    }

    // Reads stay open — elevation must not make the console unusable.
    let r = await fetch(`${base}/api/admin/rails`, { headers: A });
    ok("reads are unaffected by elevation", r.status === 200, String(r.status));

    // Wrong password must not elevate.
    r = await fetch(`${base}/api/admin/elevate`, { method: "POST", headers: A, body: JSON.stringify({ password: "wrong" }) });
    ok("elevate with the wrong password → 401", r.status === 401, String(r.status));

    // Correct password elevates and returns a NEW token.
    r = await fetch(`${base}/api/admin/elevate`, { method: "POST", headers: A, body: JSON.stringify({ password: "momome-admin" }) });
    const el = (await r.json()) as { token?: string; elevatedUntil?: number };
    ok("elevate with the correct password → 200", r.status === 200, String(r.status));
    ok("returns a fresh token", !!el.token && el.token !== token);
    ok("elevation is short-lived (≤ 10 min)", !!el.elevatedUntil && el.elevatedUntil - Date.now() <= 10 * 60_000 + 2000);
    A = { ...J, authorization: `Bearer ${el.token}` };

    // Now the same call is allowed through the gate.
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({ allowlistedIp: "203.0.113.7" }) });
    ok("elevated PUT /rails/egress → 200", r.status === 200, String(r.status));

    // Elevation must not be forgeable by editing the token payload.
    const [payload, sig] = String(el.token).split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    decoded.elv = Date.now() + 3600_000;
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT",
      headers: { ...J, authorization: `Bearer ${forged}` }, body: JSON.stringify({ allowlistedIp: "9.9.9.9" }) });
    ok("token with a hand-edited elevation claim → 401 (signature covers it)", r.status === 401, String(r.status));

    console.log("\nGo-live readiness console");
    r = await fetch(`${base}/api/admin/readiness`, { headers: A });
    const rd = (await r.json()) as { gates?: Array<{ label: string; state: string; detail: string }>; secrets?: Array<{ label: string; state: string }>; rails?: { crypto: Array<{ name: string; configured: boolean; missing: string[] }> }; egress?: unknown };
    ok("readiness returns for a Super Admin", r.status === 200, String(r.status));
    ok("reports boot gates", (rd.gates?.length ?? 0) >= 5, `${rd.gates?.length} gates`);
    ok("flags the DEFAULT admin password as blocked",
       rd.gates?.some((g) => g.label === "Admin password" && g.state === "blocked") === true);
    ok("names which IBEX vars are missing",
       (rd.rails?.crypto.find((c) => c.name === "IBEX Hub")?.missing.length ?? 0) === 3);
    ok("includes egress allowlist state", !!rd.egress);
    ok("never returns a secret VALUE", !JSON.stringify(rd).includes("momome-admin"));

    // Non-super-admins cannot read it — it enumerates exactly what is unset.
    createUser("ops1", "OpsPass123!", "Operations Manager");
    const ot = await login("ops1", "OpsPass123!");
    r = await fetch(`${base}/api/admin/readiness`, { headers: { ...J, authorization: `Bearer ${ot}` } });
    ok("non-super-admin → 403", r.status === 403, String(r.status));
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

/* Admin management of the IP allowlist, driven over REAL HTTP against createApp().

   Peexit production authenticates on the SOURCE IP — it 403s any non-allowlisted source
   regardless of the SECRETKEY — so the address registered with the rail has to be
   changeable the moment a provider allowlists a new one. An env var would require a
   redeploy at exactly the wrong time, so it lives in settings behind these endpoints.
   Asserts the guards too: this is money-path config, not a cosmetic preference. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.EGRESS_CACHE_MS = "0";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

// Stub the IP echo services so the test is network-free and deterministic.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes("ipify") || url.includes("ifconfig")) {
    return new Response(JSON.stringify({ ip: "198.51.100.42" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const J = { "content-type": "application/json" };

  const login = async (username: string, password: string) => {
    const r = await fetch(`${base}/api/admin/login`, { method: "POST", headers: J, body: JSON.stringify({ username, password }) });
    return r.ok ? ((await r.json()) as { token: string }).token : null;
  };

  try {
    console.log("\nAdmin — IP allowlist management");

    // Unauthenticated must not read OR write rail config.
    let r = await fetch(`${base}/api/admin/rails`);
    ok("GET /admin/rails unauthenticated → 401", r.status === 401, String(r.status));
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: J, body: JSON.stringify({ allowlistedIp: "1.2.3.4" }) });
    ok("PUT egress unauthenticated → 401", r.status === 401, String(r.status));

    const token = await login("admin", "momome-admin");
    ok("super-admin signed in", !!token);
    let A = { ...J, authorization: `Bearer ${token}` };

    // The allowlist repoints what a rail trusts, so it now sits behind step-up auth: a
    // stolen session token alone must not be able to change it.
    let g = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({ allowlistedIp: "1.2.3.4" }) });
    ok("un-elevated PUT → 403 elevation_required", g.status === 403, String(g.status));
    g = await fetch(`${base}/api/admin/elevate`, { method: "POST", headers: A, body: JSON.stringify({ password: "momome-admin" }) });
    A = { ...J, authorization: `Bearer ${((await g.json()) as { token: string }).token}` };
    ok("elevated for the guarded writes", g.status === 200, String(g.status));

    // The status is visible where rail config lives.
    r = await fetch(`${base}/api/admin/rails`, { headers: A });
    const rails = (await r.json()) as { egress?: { ip: string; expected: string | null; matches: boolean | null; note: string } };
    ok("GET /admin/rails exposes egress state", !!rails.egress, JSON.stringify(rails.egress?.ip));
    ok("discovers the outbound IP", rails.egress?.ip === "198.51.100.42");
    ok("nothing registered yet → matches null (not false)", rails.egress?.matches === null);

    // Record a DIFFERENT address — the drift case an operator must see.
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({ allowlistedIp: "203.0.113.5" }) });
    let body = (await r.json()) as { egress?: { expected: string | null; matches: boolean | null; note: string } };
    ok("PUT a valid IP → 200", r.status === 200, String(r.status));
    ok("recorded as expected", body.egress?.expected === "203.0.113.5");
    ok("mismatch reported immediately (no TTL wait)", body.egress?.matches === false);
    ok("note explains it is IP-based, not credentials", (body.egress?.note ?? "").includes("MISMATCH"));

    // Record the REAL address → healthy.
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({ allowlistedIp: "198.51.100.42" }) });
    body = await r.json();
    ok("registering the actual egress → matches true", body.egress?.matches === true);

    // Clearing is a legitimate state, distinct from a wrong value.
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({ allowlistedIp: "" }) });
    body = await r.json();
    ok("empty clears the record → matches null", r.status === 200 && body.egress?.matches === null);

    // Validation.
    for (const bad of ["not-an-ip", "999.1.1.1", "1.2.3", "12345"]) {
      r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({ allowlistedIp: bad }) });
      ok(`rejects ${JSON.stringify(bad)} → 400`, r.status === 400, String(r.status));
    }
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: A, body: JSON.stringify({}) });
    ok("rejects a missing field → 400", r.status === 400, String(r.status));

    // Re-check action.
    r = await fetch(`${base}/api/admin/rails/egress/recheck`, { method: "POST", headers: A });
    const rc = (await r.json()) as { egress?: { ip: string }; reachability: unknown };
    ok("POST recheck → 200 with fresh egress", r.status === 200 && rc.egress?.ip === "198.51.100.42");
    ok("reachability null while Peexit is not live", rc.reachability === null);

    // A Read-Only operator must not be able to change money-path rail config.
    createUser("viewer1", "ViewerPass123!", "Read Only");
    const vt = await login("viewer1", "ViewerPass123!");
    const V = { ...J, authorization: `Bearer ${vt}` };
    r = await fetch(`${base}/api/admin/rails`, { headers: V });
    ok("read-only CAN view rail state", r.status === 200, String(r.status));
    r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: V, body: JSON.stringify({ allowlistedIp: "1.1.1.1" }) });
    ok("read-only CANNOT set the allowlist → 403", r.status === 403, String(r.status));
    r = await fetch(`${base}/api/admin/rails/egress/recheck`, { method: "POST", headers: V });
    ok("read-only CANNOT trigger a recheck → 403", r.status === 403, String(r.status));
    // Even if a Read Only operator elevated, the role gate still denies — step-up is an
    // ADDITIONAL factor, never a substitute for the permission check.
    const ve = await fetch(`${base}/api/admin/elevate`, { method: "POST", headers: V, body: JSON.stringify({ password: "ViewerPass123!" }) });
    if (ve.status === 200) {
      const VE = { ...J, authorization: `Bearer ${((await ve.json()) as { token: string }).token}` };
      r = await fetch(`${base}/api/admin/rails/egress`, { method: "PUT", headers: VE, body: JSON.stringify({ allowlistedIp: "1.1.1.1" }) });
      ok("ELEVATED read-only still cannot set the allowlist → 403", r.status === 403, String(r.status));
    }
  } finally {
    server.close();
  }
  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

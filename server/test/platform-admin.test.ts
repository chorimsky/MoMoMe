/* Admin → API Platform, end to end over real HTTP. The operator side of API v1 hands out
   capabilities — live credentials, a developer's password, a plan's price, a customer's
   ceiling — so the rules it enforces matter as much as the ones the public API enforces.
   Each case here is a gap this review closed.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/platform-admin.test.ts */
process.env.DB_PATH = ":memory:"; process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0); await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const J = { "content-type": "application/json" };
  const tok = ((await (await fetch(`${base}/api/admin/login`, { method: "POST", headers: J, body: JSON.stringify({ username: "admin", password: "momome-admin" }) })).json()) as { token: string }).token;
  // Every guarded action below needs a step-up, which is the point: elevate once, then act.
  const el = ((await (await fetch(`${base}/api/admin/elevate`, { method: "POST", headers: { ...J, authorization: `Bearer ${tok}` }, body: JSON.stringify({ password: "momome-admin" }) })).json()) as { token: string }).token;
  const A = { ...J, authorization: `Bearer ${el}` };
  const call = async (m: string, p: string, b?: unknown) => { const r = await fetch(`${base}${p}`, { method: m, headers: A, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }; };

  try {
    console.log("\nLive credentials follow KYB, as the screen says they do\n");
    // A developer signs up exactly as a customer would.
    const su = await (await fetch(`${base}/api/developers/signup`, { method: "POST", headers: J, body: JSON.stringify({ email: "ops@example.com", name: "Ops Dev", password: "long-enough-password", organization: "Ops Co" }) })).json() as { organization: { id: string }; token: string; user: { id: string } };
    const org = su.organization.id;
    let r = await call("PATCH", `/api/admin/platform/organizations/${org}`, { liveEnabled: true });
    ok("live cannot be switched on while KYB is not verified", r.status === 409 && r.body.error === "kyb_required", `${r.status} ${r.body.error ?? ""}`);
    r = await call("PATCH", `/api/admin/platform/organizations/${org}`, { liveEnabled: true, kyb: "verified" });
    ok("…but recording the verification in the same change is allowed", r.status === 200 && r.body.liveEnabled === true && r.body.kyb === "verified", `${r.status}`);
    r = await call("PATCH", `/api/admin/platform/organizations/${org}`, { liveEnabled: false });
    ok("turning live OFF is never blocked", r.status === 200 && r.body.liveEnabled === false);

    console.log("\nA plan prices every customer on it — the numbers are checked\n");
    r = await call("PUT", "/api/admin/platform/plans/developer", { platformFeePct: "abc" });
    ok("a non-numeric fee is refused, not stored as NaN", r.status === 400, `${r.status} ${r.body.message ?? ""}`);
    r = await call("PUT", "/api/admin/platform/plans/developer", { platformFeePct: -1 });
    ok("a negative fee is refused", r.status === 400);
    r = await call("PUT", "/api/admin/platform/plans/developer", { rateLimitRpm: 0 });
    ok("a zero rate limit is refused (it would lock every customer out)", r.status === 400);
    r = await call("PUT", "/api/admin/platform/plans/developer", { tiers: [{ upToXaf: "x", pct: 1 }] });
    ok("a malformed tier is refused", r.status === 400);
    r = await call("PUT", "/api/admin/platform/plans/developer", { platformFeePct: 1.4 });
    ok("a sane change still saves", r.status === 200 && r.body.platformFeePct === 1.4, `${r.status}`);

    console.log("\nLimit rules\n");
    r = await call("PUT", "/api/admin/platform/limits", { name: "x", ceilings: { perPaymentXaf: "lots" } });
    ok("a non-numeric ceiling is refused — it would silently limit nothing", r.status === 400);
    r = await call("PUT", "/api/admin/platform/limits", { name: "x", scope: "everything" });
    ok("a scope that is not an object is refused", r.status === 400);
    r = await call("PUT", "/api/admin/platform/limits", { name: "Cap", ceilings: { perPaymentXaf: 500000 } });
    ok("a well-formed rule saves", r.status === 200 && !!r.body.id, `${r.status}`);

    console.log("\nManual credit is a liability we then owe\n");
    r = await call("POST", `/api/admin/platform/organizations/${org}/credit`, { xaf: 5_000_000_000 });
    ok("an absurd credit is refused rather than booked", r.status === 400 && r.body.error === "amount_too_large", `${r.status} ${r.body.error ?? ""}`);
    r = await call("POST", `/api/admin/platform/organizations/${org}/credit`, { xaf: 0 });
    ok("a zero credit is refused", r.status === 400);
    r = await call("POST", `/api/admin/platform/organizations/${org}/credit`, { xaf: 25_000, reference: "batch-1" });
    ok("a real credit is booked and the balance reflects it", r.status === 200 && r.body.balance?.available === 25_000, JSON.stringify(r.body.balance ?? r.body));

    console.log("\nA leaked key can be killed on its own\n");
    const made = await (await fetch(`${base}/api/developers/orgs/${org}/credentials`, { method: "POST", headers: { ...J, authorization: `Bearer ${su.token}` }, body: JSON.stringify({ environment: "test", label: "leaked" }) })).json() as { credential: { id: string }; secret: string };
    const cred = { id: made.credential.id, secret: made.secret };
    let v1 = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${cred.secret}` } });
    ok("the credential authenticates before it is revoked", v1.status === 200, String(v1.status));
    r = await call("POST", `/api/admin/platform/credentials/${cred.id}/revoke`, { reason: "posted in a public repo" });
    ok("the operator revokes that one credential", r.status === 200 && r.body.credential?.status === "revoked", `${r.status} ${r.body.credential?.status ?? r.body.error ?? ""}`);
    v1 = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${cred.secret}` } });
    ok("…and it stops authorising immediately — the organization keeps running", v1.status === 401, String(v1.status));
    r = await call("POST", `/api/admin/platform/credentials/${cred.id}/revoke`, {});
    ok("revoking it twice is refused, not a second event", r.status === 409, String(r.status));
    const audit = await call("GET", "/api/admin/platform/audit");
    ok("the revocation is in the audit trail with its reason", (audit.body.events ?? []).some((e: Record<string, any>) => e.action === "credential.revoked_by_operator" && e.details?.reason === "posted in a public repo"));

    console.log("\nThe activation queue is the OTHER door into live money\n");
    // A second organization, untouched, so its KYB is genuinely "not started".
    const su2 = await (await fetch(`${base}/api/developers/signup`, { method: "POST", headers: J, body: JSON.stringify({ email: "two@example.com", name: "Two", password: "long-enough-password", organization: "Two Co" }) })).json() as { organization: { id: string }; token: string };
    const org2 = su2.organization.id; const D2 = { ...J, authorization: `Bearer ${su2.token}` };
    const submit = (b: Record<string, string>) => fetch(`${base}/api/developers/orgs/${org2}/requests`, { method: "POST", headers: D2, body: JSON.stringify(b) });
    await submit({ kind: "kyb", legal_name: "Two Co SARL", registration_number: "RC/DLA/2026/B/1", country: "CM", contact_name: "Ada" });
    await submit({ kind: "live_access", note: "ready" });
    let q = await call("GET", "/api/admin/platform/requests");
    const rowOf = (kind: string) => (q.body.requests ?? []).find((x: Record<string, any>) => x.orgId === org2 && x.kind === kind);
    ok("a queue row carries the state the decision turns on", rowOf("live_access")?.context?.kyb === "pending" && typeof rowOf("live_access")?.context?.credentials === "number", JSON.stringify(rowOf("live_access")?.context ?? {}));
    ok("live access is flagged as blocked while the company is unverified", rowOf("live_access")?.blocked === "kyb_not_verified", String(rowOf("live_access")?.blocked));
    let r2 = await call("POST", `/api/admin/platform/requests/${rowOf("live_access").id}/approve`, {});
    ok("approving live access before KYB is refused", r2.status === 409 && r2.body.error === "kyb_required", `${r2.status} ${r2.body.error ?? ""}`);
    let o2 = await call("GET", `/api/admin/platform/organizations/${org2}`);
    ok("…and the refusal changed nothing: not live, and NOT stamped verified", o2.body.organization.liveEnabled === false && o2.body.organization.kyb === "pending", `${o2.body.organization.liveEnabled} ${o2.body.organization.kyb}`);
    r2 = await call("POST", `/api/admin/platform/requests/${rowOf("kyb").id}/approve`, { note: "documents checked" });
    ok("the company-verification request is decided on its own", r2.status === 200 && r2.body.status === "approved", `${r2.status}`);
    q = await call("GET", "/api/admin/platform/requests");
    ok("live access is no longer blocked once the company is verified", rowOf("live_access")?.blocked === null, String(rowOf("live_access")?.blocked));
    r2 = await call("POST", `/api/admin/platform/requests/${rowOf("live_access").id}/approve`, {});
    ok("…and now it is granted", r2.status === 200 && r2.body.status === "approved", `${r2.status}`);
    o2 = await call("GET", `/api/admin/platform/organizations/${org2}`);
    ok("the organization is live, on a verification a human decided", o2.body.organization.liveEnabled === true && o2.body.organization.kyb === "verified");
    r2 = await call("POST", `/api/admin/platform/requests/${rowOf("live_access").id}/approve`, {});
    ok("a decided request cannot be decided twice", r2.status === 409 && r2.body.error === "already_decided", `${r2.status} ${r2.body.error ?? ""}`);

    console.log("\nAn IP allow-list the dashboard can actually set\n");
    // The API has enforced this since API v1 shipped and the plans page sells it, but there
    // was no way to set it short of a hand-written request.
    const pinned = await (await fetch(`${base}/api/developers/orgs/${org}/credentials`, { method: "POST", headers: { ...J, authorization: `Bearer ${su.token}` }, body: JSON.stringify({ environment: "test", label: "pinned", ip_allowlist: ["203.0.113.10"] }) })).json() as { credential: { id: string; ipAllowlist?: string[] }; secret: string };
    ok("a credential can be created with an allow-list", pinned.credential.ipAllowlist?.[0] === "203.0.113.10", JSON.stringify(pinned.credential.ipAllowlist ?? null));
    let v1b = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${pinned.secret}` } });
    ok("a call from any other address is refused", v1b.status === 403 || v1b.status === 401, String(v1b.status));
    await fetch(`${base}/api/developers/orgs/${org}/credentials/${pinned.credential.id}`, { method: "PATCH", headers: { ...J, authorization: `Bearer ${su.token}` }, body: JSON.stringify({ ip_allowlist: null }) });
    v1b = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${pinned.secret}` } });
    ok("clearing the allow-list lets it through again", v1b.status === 200, String(v1b.status));

    console.log("\nAn unknown float is not a zero float\n");
    const t = await call("GET", "/api/admin/platform/treasury");
    ok("a float nobody could read comes back null, with the reason per rail", t.body.total === null && Array.isArray(t.body.float_unknown_reason) && t.body.float_unknown_reason.length > 0, JSON.stringify(t.body.float_unknown_reason ?? t.body.total));
    ok("available is withheld rather than guessed at zero", t.body.available === null);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`); process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

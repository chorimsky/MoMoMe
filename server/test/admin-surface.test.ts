/* The console must report what the system DOES, not re-derive it.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/admin-surface.test.ts

   Two drifts this pins down, both found by reading the admin surface against the engine:

   1. /admin/identity-resolution built its "chain order" by re-parsing
      IDENTITY_PROVIDER_PRIORITY against a SECOND hardcoded default of its own. That default
      had drifted and omitted campay_holder, so the console showed an operator a chain that
      did not contain the provider actually answering — while the real chain was computed
      somewhere else entirely. It now asks the resolver.
   2. CamPay was absent from the payout rails list while being a registered payout rail, so
      during the Peexit outage the one rail still working was the one an operator could not
      see: not its environment, not whether its key was accepted, not that it was answering. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "admin-surface-test";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
// The exact production value that hid campay_holder from the chain.
process.env.IDENTITY_PROVIDER_PRIORITY = "peexit_verify,mtn_direct,orange_direct,pawapay";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const admin = createUser("surface-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
  const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token };
  const get = async (p: string) => { const r = await fetch(`${root}${p}`, { headers: A }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };

  try {
    console.log("\nIdentity: the console shows the resolver's chain, not its own guess\n");
    const id = await get("/admin/identity-resolution");
    ok("the endpoint answers a Super Admin", id.status === 200, String(id.status));
    ok("chain order includes campay_holder despite the env omitting it", (id.body.priority ?? []).includes("campay_holder"), (id.body.priority ?? []).join(","));
    ok("the operator's stated order still leads", (id.body.priority ?? []).indexOf("peexit_verify") === 0, (id.body.priority ?? []).join(","));
    ok("`effective` names who would really be asked", Array.isArray(id.body.effective) && id.body.effective.includes("campay_holder"), (id.body.effective ?? []).join(","));
    ok("`disabled` is reported, not inferred from absence", Array.isArray(id.body.disabled), JSON.stringify(id.body.disabled));
    // The useful fact is the DIFFERENCE: ranked but unable to answer is not the same as off.
    ok("a ranked-but-unanswering provider is in priority and not in effective",
      (id.body.priority ?? []).includes("mtn_direct") && !(id.body.effective ?? []).includes("mtn_direct"),
      `priority=${(id.body.priority ?? []).join(",")} effective=${(id.body.effective ?? []).join(",")}`);

    console.log("\nRails: every registered payout rail is visible\n");
    const rails = await get("/admin/rails");
    ok("the endpoint answers a Super Admin", rails.status === 200, String(rails.status));
    const names = (rails.body.payout ?? []).map((p: { name: string }) => p.name.toLowerCase());
    ok("CamPay appears in the payout rails", names.includes("campay"), names.join(","));
    ok("…alongside Peexit and PawaPay", names.includes("peexit") && names.includes("pawapay"), names.join(","));
    const cp = (rails.body.payout ?? []).find((p: { name: string }) => p.name.toLowerCase() === "campay");
    ok("CamPay reports configured/live like the others", cp && typeof cp.configured === "boolean" && typeof cp.live === "boolean", JSON.stringify({ configured: cp?.configured, live: cp?.live }));
    ok("CamPay's key is MASKED, never echoed", typeof cp?.apiKey === "string" && !cp.apiKey.includes("test-token-not-a-real-credential"), String(cp?.apiKey));
    ok("CamPay carries a reachability field", "reachability" in (cp ?? {}), JSON.stringify(cp?.reachability));

    console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  } finally { server.close(); }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

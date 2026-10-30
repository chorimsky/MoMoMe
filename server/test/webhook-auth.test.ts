/* Every webhook route must authenticate its caller, or refuse.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/webhook-auth.test.ts

   THE BUG THIS PINS. handleCollectCallback read:

       if (rail.verifyCallback && !rail.verifyCallback(raw, headers)) → 401

   A rail that implements NO verifyCallback therefore skipped the check rather than failing
   it. MTN Collections is exactly that rail — it signs nothing — which is why it was given a
   URL only it knows, /webhooks/collect/mtn/<secret>, guarded by a constant-time compare.
   But the generic /webhooks/collect/:name route still matched /collect/mtn and landed on
   that optional check, so the secret was optional: omit it and you were let in.

   Money was never reachable this way — settlement is gated on the authoritative status()
   re-query, never the posted body. The audit trail was: an unauthenticated caller could
   write their own bytes into the event log marked `status: "verified"`, and make the server
   re-query MTN for any reference they chose to guess. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "webhook-auth-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const forged = JSON.stringify({ external_reference: "mm-forged-001", status: "SUCCESSFUL", amount: "900000" });
  const post = async (path: string, body = forged): Promise<{ status: number }> => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    return { status: r.status };
  };

  console.log("\n  the generic collect route must not accept a rail that signs nothing\n");
  let r = await post("/webhooks/collect/mtn");
  ok("POST /webhooks/collect/mtn without the path secret is refused", r.status === 401, `got ${r.status}`);
  ok("…and is not silently accepted", r.status !== 200, `got ${r.status}`);

  r = await post("/webhooks/collect/mtn/not-the-secret");
  ok("…and a WRONG path secret is refused too", r.status === 401, `got ${r.status}`);

  /* The other rails are DELIBERATELY permissive here. peexit / campay / pawapay each return
     "accept" from verifyCallback when no callback credential is configured AND the rail is
     not live, so a sandbox can be exercised without credentials while production fails
     closed. That is config-dependent, so it is not asserted from a sandbox run. What IS
     asserted is that MTN is refused even here, where everything else is waved through —
     which is the point: the refusal above is a real guard, not sandbox strictness. */
  console.log("\n  every other collector IS permissive in sandbox — so the refusal above is the guard, not the mode\n");
  for (const rail of ["peexit", "campay"]) {
    const rr = await post(`/webhooks/collect/${rail}`);
    ok(`sandbox lets ${rail} through (it implements verifyCallback)`, rr.status === 200, `got ${rr.status}`);
  }

  console.log("\n  an unknown rail is a 404, never a 200\n");
  r = await post("/webhooks/collect/not-a-rail");
  ok("unknown collector → 404", r.status === 404, `got ${r.status}`);

  console.log("\n  the crypto webhook verifies unconditionally\n");
  r = await post("/webhooks/ibex", JSON.stringify({ hook: "forged" }));
  ok("POST /webhooks/ibex unsigned is refused", r.status === 401 || r.status === 404, `got ${r.status}`);

  server.close();
  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

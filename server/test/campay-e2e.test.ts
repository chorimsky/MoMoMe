/* CamPay end to end, through the real HTTP surface.

   The unit tests in campay.test.ts pin our contract with CamPay's API. This one drives the
   part that only breaks once everything is plugged together: a signed callback arriving at
   the ONE URL CamPay posts both flows to, being routed by `endpoint` to the payout or the
   collection path, and settling the right record.

   It was written because reviewing the integration end to end found a bug the unit tests
   could not see. The collection callback handler finds the transfer by reading a reference
   out of the body, trying a list of field names. `reference` was in that list and
   `external_reference` was not — and CamPay's `reference` is ITS uuid, not ours. So every
   CamPay collection keyed settlement on an id that matches no transfer we hold, silently
   settled nothing, and waited for the reconcile tick instead. The fix is two-sided: send
   our raw key as external_reference on /collect/ (only /withdraw/ needs a UUID4), and read
   that field FIRST, ahead of the rail's own id.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/campay-e2e.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key-not-a-credential";

import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

const KEY = "test-webhook-key-not-a-credential";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** A callback as CamPay sends it: one body, `endpoint` saying which flow, JWT signature. */
function callback(fields: Record<string, string>, opts: { key?: string; claims?: object } = {}): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${b({ alg: "HS256", typ: "JWT" })}.${b(opts.claims ?? { reference: fields.reference })}`;
  const sig = crypto.createHmac("sha256", opts.key ?? KEY).update(head).digest("base64url");
  return JSON.stringify({ ...fields, signature: `${head}.${sig}` });
}

async function main() {
  const { createApp } = await import("../src/app.js");
  const campay = await import("../src/adapters/campay.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string) => fetch(`${base}/webhooks/campay`, { method: "POST", headers: { "content-type": "application/json" }, body });

  try {
    console.log("\nThe one URL CamPay posts both flows to\n");
    const unsigned = await post(JSON.stringify({ status: "SUCCESSFUL", endpoint: "withdraw", reference: "x" }));
    ok("an unsigned callback is refused", unsigned.status === 401, String(unsigned.status));
    const wrongKey = await post(callback({ status: "SUCCESSFUL", endpoint: "withdraw", reference: "x" }, { key: "not-the-key" }));
    ok("a callback signed with the wrong key is refused", wrongKey.status === 401, String(wrongKey.status));
    const noEndpoint = await post(callback({ status: "SUCCESSFUL", reference: "x" }));
    ok("a body with no `endpoint` is refused, not guessed at", noEndpoint.status === 400, String(noEndpoint.status));
    ok("…saying which field is missing", (await noEndpoint.json() as { error?: string }).error === "missing_endpoint");
    const getReq = await fetch(`${base}/webhooks/campay?status=SUCCESSFUL&endpoint=collect`);
    ok("a GET is not accepted — the dashboard must be set to POST", getReq.status === 404 || getReq.status === 405, String(getReq.status));

    console.log("\nA replayed signature cannot be pinned to a different transaction\n");
    // The token is genuinely CamPay's; the body it is wrapped in is not the one it was
    // minted for. Verification must notice, when the claims give it anything to compare.
    const replay = await post(callback({ status: "SUCCESSFUL", endpoint: "withdraw", reference: "VICTIM-REF" }, { claims: { reference: "ATTACKER-REF" } }));
    ok("a valid token attached to another transaction's body is refused", replay.status === 401, String(replay.status));
    const unbound = await post(callback({ status: "SUCCESSFUL", endpoint: "withdraw", reference: "whatever" }, { claims: { foo: "bar" } }));
    ok("…while claims that name nothing comparable still pass (the re-query is the gate)", unbound.status === 200, String(unbound.status));

    console.log("\nA withdraw callback reaches the PAYOUT path and names our ref\n");
    await campay.disburse({ idempotencyKey: "MMM-E2E-0001", provider: "MTN", country: "CM", phone: "+237670000001", xaf: 5000 } as never);
    const rec = campay.statusByKey("MMM-E2E-0001")!;
    ok("the payout is on record", Boolean(rec?.providerRef));
    const ev = campay.parseCallbackEvents(JSON.parse(callback({ status: "SUCCESSFUL", endpoint: "withdraw", reference: rec.providerRef, external_reference: "irrelevant-uuid" })));
    ok("the callback resolves to OUR payment ref, not CamPay's id", ev[0]?.ref === "MMM-E2E-0001", JSON.stringify(ev));
    const payoutCb = await post(callback({ status: "SUCCESSFUL", endpoint: "withdraw", reference: rec.providerRef }));
    ok("the route accepts it", payoutCb.status === 200, String(payoutCb.status));

    console.log("\nA collect callback carries a reference we can actually find a transfer BY\n");
    // This is the bug. /collect/ sends our raw key as external_reference, and the handler
    // reads external_reference BEFORE the rail's own `reference`.
    await campay.collect({ idempotencyKey: "trf_e2e_collect_1", provider: "MTN", country: "CM", phone: "+237670000002", xaf: 2500 } as never);
    const cRec = campay.statusByKey("trf_e2e_collect_1")!;
    const cEv = campay.parseCallbackEvents(JSON.parse(callback({ status: "SUCCESSFUL", endpoint: "collect", reference: cRec.providerRef, external_reference: "trf_e2e_collect_1" })));
    ok("a collect callback resolves to our transfer id", cEv[0]?.ref === "trf_e2e_collect_1", JSON.stringify(cEv));
    ok("…and is marked as a collection, not a payout", cEv[0]?.endpoint === "collect");

    // THE handler's extraction, imported — not a copy of it. A copied list would keep
    // passing after someone edited the real one, which is the failure this test exists for.
    const { referenceFromBody: extracted } = await import("../src/routes/webhooks.js");
    ok("the handler reads OUR key out of a CamPay body, not CamPay's uuid",
      extracted({ reference: "cp-uuid-abc", external_reference: "trf_e2e_collect_1" }) === "trf_e2e_collect_1",
      extracted({ reference: "cp-uuid-abc", external_reference: "trf_e2e_collect_1" }));
    ok("…and a rail that sends ONLY its own reference still resolves (unchanged for others)",
      extracted({ reference: "px-track-9" }) === "px-track-9");
    const collectCb = await post(callback({ status: "SUCCESSFUL", endpoint: "collect", reference: cRec.providerRef, external_reference: "trf_e2e_collect_1" }));
    ok("the route accepts the collect callback", collectCb.status === 200, String(collectCb.status));

    console.log("\nThe same bytes twice are handled once\n");
    const body = callback({ status: "SUCCESSFUL", endpoint: "withdraw", reference: rec.providerRef });
    await post(body);
    const dup = await post(body);
    ok("a replayed identical callback is reported as a duplicate", (await dup.json() as { duplicate?: boolean }).duplicate === true);

    console.log("\nWhat we send CamPay differs per flow, on purpose\n");
    const { payoutIdFor } = await import("../src/adapters/pawapay.js");
    ok("withdraw sends a derived UUID4 (CamPay demands one)", /^[0-9a-f-]{36}$/.test(payoutIdFor("MMM-E2E-0001")));
    ok("…which is stable, so a retry is the same request", payoutIdFor("MMM-E2E-0001") === payoutIdFor("MMM-E2E-0001"));
    ok("…and differs per payment", payoutIdFor("MMM-E2E-0001") !== payoutIdFor("MMM-E2E-0002"));
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

/* ============================================================
   HTTP route-level auth + feature-enforcement test.

   The suite had no endpoint-level coverage of the authorization guards that are
   the primary defense for a real-money API. This drives REAL requests against a
   listening `createApp()` (no supertest dep — Node's global fetch) and asserts:
   - contacts / merchant feature flags are enforced server-side (feature_off 403,
     GET vault → [] when off) and re-open when toggled back on;
   - the vault write denies a request with no device identity (no_device 401);
   - /simulate can't be driven for an unknown/foreign payment id (404);
   - the cron endpoint rejects a missing/wrong bearer when CRON_SECRET is set.

   Run: pnpm --filter @momome/server test:http
   ============================================================ */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const setFeature = (k: string, v: boolean) => updateSettings({ features: { ...getSettings().features, [k]: v } });

  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "x-mm-sender": "dev-http-1", "content-type": "application/json" };
  const RECORD = JSON.stringify({ ciphertext: "Y2lwaGVy", iv: "aXZpdg==", ver: 1 });

  try {
    console.log("\nHTTP — contacts feature enforcement (/me/vault)");
    let r = await fetch(`${base}/api/me/vault/rec1`, { method: "PUT", headers: DEV, body: RECORD });
    ok("contacts ON → vault PUT accepted", r.status === 200, String(r.status));

    setFeature("contacts", false);
    r = await fetch(`${base}/api/me/vault/rec1`, { method: "PUT", headers: DEV, body: RECORD });
    ok("contacts OFF → vault PUT 403 feature_off", r.status === 403 && (await r.json()).error === "feature_off", String(r.status));
    r = await fetch(`${base}/api/me/vault`, { headers: { "x-mm-sender": "dev-http-1" } });
    const list = await r.json();
    ok("contacts OFF → vault GET returns []", r.status === 200 && Array.isArray(list) && list.length === 0);

    setFeature("contacts", true);
    r = await fetch(`${base}/api/me/vault/rec1`, { method: "PUT", headers: DEV, body: RECORD });
    ok("contacts back ON → vault PUT accepted again", r.status === 200, String(r.status));

    console.log("\nHTTP — device auth (deny by default)");
    r = await fetch(`${base}/api/me/vault/recX`, { method: "PUT", headers: { "content-type": "application/json" }, body: RECORD });
    ok("no X-MM-Sender → vault PUT 401 no_device", r.status === 401, String(r.status));

    console.log("\nHTTP — merchant feature enforcement (/merchant)");
    const merchBody = JSON.stringify({ businessName: "Test Biz", country: "CM", settlementPhone: "677000000", tier: "individual" });
    setFeature("merchant", false);
    r = await fetch(`${base}/api/merchant`, { method: "POST", headers: DEV, body: merchBody });
    ok("merchant OFF → POST /merchant 403 feature_off", r.status === 403 && (await r.json()).error === "feature_off", String(r.status));
    setFeature("merchant", true);
    r = await fetch(`${base}/api/merchant`, { method: "POST", headers: DEV, body: merchBody });
    const body = await r.json().catch(() => ({}));
    ok("merchant ON → not feature_off (handler proceeds)", !(r.status === 403 && body.error === "feature_off"), String(r.status));

    console.log("\nHTTP — /simulate ownership (no id-guessing)");
    r = await fetch(`${base}/api/payments/does-not-exist/simulate`, { method: "POST", headers: DEV });
    ok("simulate unknown id → 404", r.status === 404, String(r.status));

    console.log("\nHTTP — cron guard (CRON_SECRET set)");
    process.env.CRON_SECRET = "cron-test-secret";
    r = await fetch(`${base}/api/cron/tick`, { method: "GET" });
    ok("cron: missing bearer → 401", r.status === 401, String(r.status));
    r = await fetch(`${base}/api/cron/tick`, { method: "GET", headers: { authorization: "Bearer wrong-secret" } });
    ok("cron: wrong bearer → 401", r.status === 401, String(r.status));
    delete process.env.CRON_SECRET;
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });

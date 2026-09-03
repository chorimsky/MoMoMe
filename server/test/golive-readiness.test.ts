/* The go-live console has to answer the question it exists for.

   Its gates were all "is this configured", and every one of them passed while the
   platform refused every single payment for a week. None asked whether money could
   actually leave. A readiness page that reports green while nothing can be paid out is
   worse than no page: it is the thing an operator trusts instead of checking.

   Also covers the app-link association files. Those were answering with the web app's
   index.html, so Apple and Google got HTML where JSON was required and every payment
   link silently opened a browser tab instead of the app. They are served from the server
   now — and must 404 rather than emit a placeholder, because the platforms cache what
   they fetch and a wrong file outlives its correction. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PUBLIC_URL = "https://example.test";
process.env.ADMIN_PASSWORD = "audit-test-password-9271";
process.env.ADMIN_SESSION_SECRET = "test-session-secret-for-readiness-suite";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { store } = await import("../src/db/store.js");
  const { strandedEarmarks, releaseStrandedEarmarks, availableFloatXaf } = await import("../src/core/stateMachine.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nGo-live readiness — does it answer the question it exists for?\n");

    /* ---- app-link association files ---- */
    const aasa = await fetch(`${base}/.well-known/apple-app-site-association`);
    ok("unconfigured iOS links 404 rather than serve a placeholder", aasa.status === 404, String(aasa.status));
    ok("…and say why", ((await aasa.json()) as any).message?.includes("APPLE_TEAM_ID"));

    const al = await fetch(`${base}/.well-known/assetlinks.json`);
    ok("unconfigured Android links 404 rather than serve a placeholder", al.status === 404, String(al.status));

    // Now configure them the way a real deployment would.
    process.env.APPLE_TEAM_ID = "A1B2C3D4E5";
    process.env.ANDROID_CERT_SHA256 =
      "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5, " +
      "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";

    const aasa2 = await fetch(`${base}/.well-known/apple-app-site-association`);
    const aasaBody = (await aasa2.json()) as any;
    ok("configured iOS links serve JSON", aasa2.status === 200 && (aasa2.headers.get("content-type") ?? "").includes("application/json"));
    ok("the appID is teamId.bundleId", aasaBody.applinks?.details?.[0]?.appIDs?.[0] === "A1B2C3D4E5.com.momome.app",
       aasaBody.applinks?.details?.[0]?.appIDs?.[0]);
    ok("payment paths are claimed", JSON.stringify(aasaBody).includes("/pay/*"));

    const al2 = await fetch(`${base}/.well-known/assetlinks.json`);
    const alBody = (await al2.json()) as any;
    ok("configured Android links serve JSON", al2.status === 200);
    // BOTH the Play App Signing cert and the upload key must be listed, or links break
    // for whichever build presents the other one.
    ok("every valid fingerprint is listed, not just the first",
       alBody[0]?.target?.sha256_cert_fingerprints?.length === 2,
       String(alBody[0]?.target?.sha256_cert_fingerprints?.length));
    ok("the relation grants URL handling", alBody[0]?.relation?.includes("delegate_permission/common.handle_all_urls"));

    // A malformed fingerprint must be dropped, not passed through — Google rejects the
    // whole file if any entry is wrong, which would break links that were working.
    process.env.ANDROID_CERT_SHA256 = "not-a-fingerprint, 14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
    const al3 = (await (await fetch(`${base}/.well-known/assetlinks.json`)).json()) as any;
    ok("a malformed fingerprint is dropped rather than published",
       al3[0]?.target?.sha256_cert_fingerprints?.length === 1,
       String(al3[0]?.target?.sha256_cert_fingerprints?.length));

    /* ---- stranded earmarks: detection, then release ---- */
    const before = await availableFloatXaf();
    // A payment at rest holding an earmark — the shape that accumulated 436,482 XAF.
    const now = new Date().toISOString();
    await store().putPayment({
      id: "pay_stranded", ref: "MMM-STRANDED", quoteId: "q_s", state: "MANUAL_REVIEW",
      displayStatus: "Pending", method: "LIGHTNING",
      recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "T", nameSource: "manual" },
      xaf: 250_000, feeXaf: 6_250, totalXaf: 256_250, usd: 400,
      payInstruction: { method: "LIGHTNING", code: "ln", qr: "lightning:ln", asset: "BTC", amount: 0.004,
        amountLabel: "0.004 BTC", expiresAt: now, providerRef: "ph_s", provider: "ibex" },
      events: [{ at: now, state: "QUOTED" }], createdAt: now, updatedAt: now,
    } as any);
    await store().recordTxn("pay_stranded", [
      { account: "fx_position", direction: "debit", amount: 250_000, currency: "XAF" },
      { account: "payout_float_XAF", direction: "credit", amount: 250_000, currency: "XAF" },
    ]);

    // And one that IS in flight — its delivery leg will debit the earmark, so releasing
    // it would over-release. It must be left strictly alone.
    await store().putPayment({
      id: "pay_inflight", ref: "MMM-INFLIGHT", quoteId: "q_i", state: "PAYOUT_REQUESTED",
      displayStatus: "Pending", method: "LIGHTNING",
      recipient: { phone: "677000001", country: "CM", provider: "MTN", name: "T", nameSource: "manual" },
      xaf: 40_000, feeXaf: 1_000, totalXaf: 41_000, usd: 65,
      payInstruction: { method: "LIGHTNING", code: "ln2", qr: "lightning:ln2", asset: "BTC", amount: 0.0006,
        amountLabel: "0.0006 BTC", expiresAt: now, providerRef: "ph_i", provider: "ibex" },
      events: [{ at: now, state: "QUOTED" }], createdAt: now, updatedAt: now,
    } as any);
    await store().recordTxn("pay_inflight", [
      { account: "fx_position", direction: "debit", amount: 40_000, currency: "XAF" },
      { account: "payout_float_XAF", direction: "credit", amount: 40_000, currency: "XAF" },
    ]);

    const found = await strandedEarmarks();
    ok("the stranded earmark is found", found.some((e) => e.paymentId === "pay_stranded"), `${found.length} found`);
    ok("the in-flight payout is NOT treated as stranded", !found.some((e) => e.paymentId === "pay_inflight"));
    ok("it reports the amount held", found.find((e) => e.paymentId === "pay_stranded")?.xaf === 250_000);

    const depressed = await availableFloatXaf();
    ok("both earmarks depress the float while held", depressed === before - 290_000, `${depressed} vs ${before - 290_000}`);

    const rel = await releaseStrandedEarmarks();
    ok("the release returns the stranded amount", rel.released === 1 && rel.xaf === 250_000, `${rel.released} / ${rel.xaf}`);

    const after = await availableFloatXaf();
    ok("the float recovers by exactly that amount", after === depressed + 250_000, `${after} vs ${depressed + 250_000}`);
    ok("the in-flight earmark is still held", after === before - 40_000, `${after} vs ${before - 40_000}`);

    // Idempotent: an operator double-click must not release twice and invent float.
    const again = await releaseStrandedEarmarks();
    ok("a second release finds nothing", again.released === 0 && again.xaf === 0);
    ok("and the float is unchanged", (await availableFloatXaf()) === after);

    // The books must still balance after all that.
    const entries = await store().allEntries();
    const net = entries.filter((e) => e.currency === "XAF")
      .reduce((n, e) => n + (e.direction === "debit" ? e.amount : -e.amount), 0);
    ok("XAF still nets to zero after the release", Math.abs(net) < 1e-6, String(net));

    /* ---- readiness gates ---- */
    const login = await fetch(`${base}/api/admin/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: process.env.ADMIN_PASSWORD }),
    });
    const token = ((await login.json()) as any)?.token;
    ok("a super-admin session is available for the console", !!token);

    const rd = await (await fetch(`${base}/api/admin/readiness`, { headers: { authorization: `Bearer ${token}` } })).json() as any;
    ok("readiness reports whether money can move at all", Array.isArray(rd.money) && rd.money.length >= 3, JSON.stringify(rd.money?.map((m: any) => m.label)));
    const labels = (rd.money ?? []).map((m: any) => m.label);
    ok("it gates on payout capacity", labels.includes("Payout capacity"));
    ok("it gates on having a routable rail", labels.includes("Routable payout rails"));
    ok("it surfaces float committed to nothing", labels.includes("Float committed to nothing"));
    ok("it reports app-link claims", Array.isArray(rd.links) && rd.links.length === 2);

    // With no rail configured at all, capacity must not read green.
    const capacity = (rd.money ?? []).find((m: any) => m.label === "Routable payout rails");
    ok("no configured rail is BLOCKED, not a warning", capacity?.state === "blocked", capacity?.state);
    ok("and it names the fix", typeof capacity?.fix === "string" || capacity?.detail?.includes("NONE"), capacity?.detail);
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();

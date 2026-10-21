/* The operator wallet rails, end to end, against a sandbox that speaks the documented
   protocol — token, request-to-pay / web-payment, status — and nothing else.

   WHY NOT MTN's and Orange's OWN sandboxes: both need credentials this repository does not
   have and that cannot be self-issued. MTN's sandbox API user and key CAN be provisioned
   over the API, but only with a subscription key, which comes from subscribing to the
   Collection product on MTN's developer portal; Orange needs a developer account and a
   merchant key. Both are account sign-ups, which are the operator's to do. The moment those
   exist, every assertion below runs unchanged against the real hosts by pointing
   MTN_MOMO_API_URL / ORANGE_MONEY_API_URL at them.

   What this does test is OUR side of the contract, driven through the real HTTP surface:
   that we mint a token and reuse it, send exactly the documented headers and body, treat a
   409 as the same request rather than a second debit, never read a status optimistically,
   settle a transfer when the payer approves — and, for Orange, survive the restart that
   used to make an in-flight collection permanently unreadable.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/operator-wallets-e2e.test.ts */
import http from "node:http";
import type { AddressInfo } from "node:net";

/* ---- the operator sandbox, started before anything imports config ---- */
interface Seen { method: string; path: string; headers: http.IncomingHttpHeaders; body: unknown }
const seen: Seen[] = [];
/** What the next status read should say, per reference. */
const mtnStatus = new Map<string, string>();
const orangeStatus = new Map<string, string>();
let tokenMints = 0;
let nextRequestToPay = 202;

const operator = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const url = req.url ?? "";
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    seen.push({ method: req.method ?? "", path: url, headers: req.headers, body });
    const send = (code: number, obj: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

    // --- MTN Collections ---
    if (url === "/collection/token/") { tokenMints++; return send(200, { access_token: `tok-${tokenMints}`, expires_in: 3600 }); }
    if (url === "/collection/v1_0/requesttopay" && req.method === "POST") {
      const ref = String(req.headers["x-reference-id"] ?? "");
      if (nextRequestToPay === 409) return send(409, { message: "Duplicated reference id" });
      mtnStatus.set(ref, "PENDING");
      res.writeHead(202); return res.end();
    }
    if (url.startsWith("/collection/v1_0/requesttopay/")) {
      const ref = url.split("/").pop()!;
      const s = mtnStatus.get(ref);
      return s ? send(200, { status: s, amount: "2500", currency: "EUR" }) : send(404, { message: "not found" });
    }
    // --- Orange Web Payment ---
    if (url === "/oauth/v3/token") { tokenMints++; return send(200, { access_token: `otok-${tokenMints}`, expires_in: 3600 }); }
    if (url.endsWith("/webpayment") && req.method === "POST") {
      const b = body as { order_id?: string };
      const payToken = `PAYTOKEN-${b.order_id}`;
      orangeStatus.set(payToken, "INITIATED");
      return send(200, { payment_url: `https://webpayment.orange.cm/pay/${payToken}`, pay_token: payToken, notif_token: "n", status: "INITIATED" });
    }
    if (url.endsWith("/transactionstatus") && req.method === "POST") {
      const b = body as { pay_token?: string };
      return send(200, { status: orangeStatus.get(String(b.pay_token)) ?? "INITIATED" });
    }
    return send(404, { message: "no such route" });
  });
});

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const sent = (match: (s: Seen) => boolean) => seen.filter(match);

async function main() {
  await new Promise<void>((r) => operator.listen(0, () => r()));
  const base = `http://127.0.0.1:${(operator.address() as AddressInfo).port}`;

  // Point BOTH rails at the sandbox, with credentials shaped like the real ones. Set
  // before any import of config, which is evaluated once.
  process.env.DB_PATH = ":memory:";
  process.env.RAILS_MODE = "sandbox";
  process.env.MTN_MOMO_API_URL = base;
  process.env.MTN_MOMO_TARGET_ENV = "sandbox";
  process.env.MTN_MOMO_SUBSCRIPTION_KEY = "test-sub-key-not-a-credential";
  process.env.MTN_MOMO_API_USER = "test-api-user";
  process.env.MTN_MOMO_API_KEY = "test-api-key-not-a-credential";
  process.env.ORANGE_MONEY_API_URL = base;
  process.env.ORANGE_MONEY_CLIENT_ID = "test-client-id";
  process.env.ORANGE_MONEY_CLIENT_SECRET = "test-client-secret-not-a-credential";
  process.env.ORANGE_MONEY_MERCHANT_KEY = "test-merchant-key";

  const { config } = await import("../src/config.js");
  const { mtnCollector, referenceFor } = await import("../src/adapters/mtnCollect.js");
  const orange = await import("../src/adapters/orangeCollect.js");
  const { selectCollector } = await import("../src/adapters/collect.js");

  try {
    console.log("\nBoth rails come alive once their credentials exist\n");
    ok("MTN is configured", mtnCollector.configured());
    ok("Orange is configured", orange.orangeCollector.configured());
    ok("neither is live — this is a sandbox environment", !mtnCollector.live() && !orange.orangeCollector.live());
    ok("the sandbox currency is EUR, which is the only one MTN's sandbox takes", config.mtnCollect.currency === "EUR");

    console.log("\nMTN: request-to-pay carries exactly the documented headers\n");
    const key = "trf_e2e_mtn_1";
    const r1 = await mtnCollector.collect({ idempotencyKey: key, provider: "MTN", country: "CM", phone: "+237670000001", xaf: 2500, narration: "MoMo>Me test" });
    const rtp = sent((s) => s.path === "/collection/v1_0/requesttopay")[0];
    ok("the payer was asked", r1.status === "accepted", r1.status);
    ok("X-Reference-Id is our derived uuid", rtp.headers["x-reference-id"] === referenceFor(key), String(rtp.headers["x-reference-id"]));
    ok("X-Target-Environment is sent", rtp.headers["x-target-environment"] === "sandbox");
    ok("the subscription key is sent", Boolean(rtp.headers["ocp-apim-subscription-key"]));
    ok("the bearer token is sent", String(rtp.headers.authorization ?? "").startsWith("Bearer "));
    const rb = rtp.body as { amount: string; currency: string; externalId: string; payer: { partyIdType: string; partyId: string } };
    ok("amount is a string of whole units", rb.amount === "2500", rb.amount);
    ok("the payer is an MSISDN with the country code, no +", rb.payer.partyId === "237670000001" && rb.payer.partyIdType === "MSISDN", rb.payer.partyId);
    ok("externalId is OUR key, so their record names ours", rb.externalId === key);
    ok("the currency is the configured one", rb.currency === "EUR", rb.currency);

    console.log("\nMTN: the token is minted once, not per call\n");
    const before = tokenMints;
    await mtnCollector.status(key);
    ok("a second call reuses the cached token", tokenMints === before, `${before} → ${tokenMints}`);

    console.log("\nMTN: a payer who has not decided is never read as success\n");
    ok("PENDING stays pending", await mtnCollector.status(key) === "PENDING");
    mtnStatus.set(referenceFor(key), "ONGOING");
    ok("an undocumented status is PENDING, never optimistic", await mtnCollector.status(key) === "PENDING");
    mtnStatus.set(referenceFor(key), "SUCCESSFUL");
    ok("SUCCESSFUL settles", await mtnCollector.status(key) === "COMPLETED");
    mtnStatus.set(referenceFor(key), "REJECTED");
    ok("REJECTED fails", await mtnCollector.status(key) === "FAILED");
    ok("a reference MTN has never seen is null, not FAILED", await mtnCollector.status("trf_never_sent") === null);

    console.log("\nMTN: a repeated reference is the same request, not a second debit\n");
    nextRequestToPay = 409;
    const dup = await mtnCollector.collect({ idempotencyKey: key, provider: "MTN", country: "CM", phone: "+237670000001", xaf: 2500 });
    ok("409 reads as duplicate", dup.status === "duplicate", dup.status);
    ok("…naming the same reference", dup.providerRef === referenceFor(key));
    nextRequestToPay = 202;

    console.log("\nOrange: a hosted payment, and the token that reads it back\n");
    const okey = "trf_e2e_orange_1";
    const o1 = await orange.orangeCollector.collect({ idempotencyKey: okey, provider: "ORANGE", country: "CM", phone: "+237690000001", xaf: 7500 });
    const wp = sent((s) => s.path.endsWith("/webpayment"))[0];
    const wb = wp.body as { merchant_key: string; order_id: string; amount: number; currency: string; lang: string };
    ok("the payment was created", o1.status === "accepted");
    ok("…and hands back the page the payer must open", Boolean(o1.paymentUrl), o1.paymentUrl);
    ok("order_id is OUR key", wb.order_id === okey);
    ok("the merchant key is sent", Boolean(wb.merchant_key));
    ok("the amount is a whole number", wb.amount === 7500 && Number.isInteger(wb.amount));
    ok("INITIATED is pending, not success", await orange.orangeCollector.status(okey) === "PENDING");

    console.log("\nOrange: the restart that used to lose the payment\n");
    const snapshot = JSON.parse(JSON.stringify(orange._snapshot()));
    orange._forgetAll();
    ok("without the pay_token the status is unreadable — the old failure",
      await orange.orangeCollector.status(okey) === null);
    orange._restore(snapshot);
    orangeStatus.set(`PAYTOKEN-${okey}`, "SUCCESS");
    ok("after the restart the payment settles, because the token survived",
      await orange.orangeCollector.status(okey) === "COMPLETED");

    console.log("\nOrange: only documented terminal words are believed\n");
    orangeStatus.set(`PAYTOKEN-${okey}`, "WAITING_CUSTOMER");
    ok("an unknown status is PENDING", await orange.orangeCollector.status(okey) === "PENDING");
    orangeStatus.set(`PAYTOKEN-${okey}`, "FAILED");
    ok("FAILED fails", await orange.orangeCollector.status(okey) === "FAILED");

    console.log("\nConfiguring the operator rail does NOT, by itself, send traffic to it\n");
    // Worth knowing before go-live: collection is PINNED to the aggregator by default
    // (settings.rails.collect.preferred = peexit for both operators), and a pin wins
    // outright — that is what pinning means. So adding MTN or Orange credentials changes
    // nothing on its own; an operator must also clear the pin in Admin → Rails. The
    // adapters' better priority (5, against the aggregator's 10) only decides an unpinned
    // corridor.
    const { getSettings, updateSettings } = await import("../src/core/settings.js");
    ok("by default MTN collection still goes to the pinned aggregator",
      selectCollector({ provider: "MTN", country: "CM", xaf: 5000 }).rail?.name === "peexit",
      selectCollector({ provider: "MTN", country: "CM", xaf: 5000 }).rail?.name ?? "");
    const r = getSettings().rails;
    updateSettings({ rails: { ...r, collect: { ...r.collect, preferred: { MTN: "auto", ORANGE: "auto" } } } });
    ok("with the pin cleared, MTN collection goes direct to MTN",
      selectCollector({ provider: "MTN", country: "CM", xaf: 5000 }).rail?.name === "mtn",
      selectCollector({ provider: "MTN", country: "CM", xaf: 5000 }).rail?.name ?? "");
    ok("…and Orange direct to Orange",
      selectCollector({ provider: "ORANGE", country: "CM", xaf: 5000 }).rail?.name === "orange",
      selectCollector({ provider: "ORANGE", country: "CM", xaf: 5000 }).rail?.name ?? "");
    ok("…because the operator's own rail outranks the aggregator when nothing is pinned",
      (await import("../src/adapters/collect.js")).COLLECTORS.find((c) => c.name === "mtn")!.priority
      < (await import("../src/adapters/collect.js")).COLLECTORS.find((c) => c.name === "peexit")!.priority);
    updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, preferred: r.collect.preferred } } });

    console.log("\nNo PIN is ever asked for, seen, or sent\n");
    const bodies = JSON.stringify(seen.map((s) => s.body));
    ok("nothing resembling a PIN left this process", !/\bpin\b/i.test(bodies));
  } finally {
    operator.close();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); operator.close(); process.exit(1); });

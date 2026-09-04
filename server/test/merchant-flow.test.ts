/* The merchant flow, end to end — can a business actually get paid?

   Three gaps, each on the path between signing up and accepting a payment.

   Verification was unreachable. /merchant/verify/request answered `sent: true` having sent
   nothing: requestAnchor only GENERATES a code, and the dev code is withheld once real money
   is live. So a merchant waited for an SMS that did not exist, never reached verifiedPhone,
   and could never create a pay link — the whole flow dead-ended on a message nobody sent.

   The settlement number — which every sale is disbursed to — was checked only for "at least
   8 digits" and a known prefix, so a number three digits too long was accepted as a payout
   target.

   And sale attribution compared raw digit strings, so a sale silently went unattributed
   whenever the stored and submitted forms of the same number differed. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PUBLIC_URL = "https://example.test";
delete process.env.SMS_WEBHOOK_URL;

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const realFetch = globalThis.fetch;
let smsSent: Array<{ to: string; message: string }> = [];
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://sms.test")) { smsSent.push(JSON.parse(init?.body ?? "{}")); return J({ ok: true }); }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { listNotifications } = await import("../src/core/notifications.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = (dev: string) => ({ "content-type": "application/json", "x-mm-sender": dev });
  const post = async (p: string, b: unknown, dev = "merchant-device") =>
    (await fetch(`${base}${p}`, { method: "POST", headers: H(dev), body: JSON.stringify(b) }));
  const get = async (p: string, dev = "merchant-device") => await fetch(`${base}${p}`, { headers: H(dev) });

  try {
    console.log("\nMerchant flow — can a business actually get paid?\n");

    /* ---- the settlement number is a payout target and must be shaped like one ---- */
    const tooLong = await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "677000789000" });
    ok("a settlement number three digits too long is refused", tooLong.status === 400, String(tooLong.status));
    ok("…with a message that says what is wrong", /9 digits/.test((await tooLong.json()).message ?? ""));

    const foreign = await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "+24112345678" });
    ok("a foreign settlement number is refused", foreign.status === 400, String(foreign.status));

    const notMomo = await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "620000789" });
    ok("a non-MTN/Orange number is refused as a settlement target", notMomo.status === 400);

    /* ---- a valid signup ---- */
    const created = await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "677000789" });
    ok("a valid merchant is created", created.status === 201, String(created.status));
    const cm = await created.json();
    ok("…and is NOT verified, since nobody has proved the number", cm.merchant?.verifiedPhone !== true,
       String(cm.merchant?.verifiedPhone));

    /* ---- a pay link needs a proven number ---- */
    const early = await post("/api/merchant/links", { amountXaf: 5000, label: "Coffee" });
    ok("an unverified merchant cannot create a pay link", early.status === 403, String(early.status));

    /* ---- WITHOUT an SMS provider: the API must not claim it sent one ---- */
    const noSms = await post("/api/merchant/verify/request", {});
    const noSmsBody = await noSms.json();
    ok("with no SMS provider, verification does not claim to have sent anything",
       noSmsBody.sent === false || noSms.status === 503, `${noSms.status}/${noSmsBody.sent}`);

    /* ---- WITH a provider: the code is sent, and NOT recorded ---- */
    process.env.SMS_WEBHOOK_URL = "https://sms.test/send";
    smsSent = [];
    const req2 = await post("/api/merchant/verify/request", {});
    const body2 = await req2.json();
    ok("with a provider, the code is actually sent", body2.sent === true && smsSent.length === 1,
       `sent=${body2.sent} calls=${smsSent.length}`);
    ok("…to the merchant's own number in international form", smsSent[0]?.to === "+237677000789", smsSent[0]?.to);
    ok("…and the message carries the code", /\d{6}/.test(smsSent[0]?.message ?? ""), smsSent[0]?.message?.slice(0, 40));

    // The outbox is readable by any operator with the notifications section. A stored OTP is
    // a stored ability to complete somebody else's verification.
    const code = (smsSent[0].message.match(/\d{6}/) ?? [])[0]!;
    const otpRecord = listNotifications().find((r) => r.to === "+237677000789");
    ok("the outbox records that a code was sent", !!otpRecord, otpRecord?.status);
    // Checked against the ACTUAL code — a digit run inside the phone number is not the code.
    ok("…but NOT the code itself", !!otpRecord && !otpRecord.body.includes(code), otpRecord?.body);

    /* ---- the code verifies, and only then can they trade ---- */
    const bad = await post("/api/merchant/verify", { code: "000000" });
    ok("a wrong code is rejected", bad.status === 400, String(bad.status));
    const good = await post("/api/merchant/verify", { code });
    ok("the right code verifies the merchant", good.status === 200, String(good.status));
    ok("…and the number is now proven", (await good.json()).merchant?.verifiedPhone === true);

    const link = await post("/api/merchant/links", { amountXaf: 5000, label: "Coffee" });
    ok("a verified merchant CAN create a pay link", link.status === 201, String(link.status));
    const linkCode = (await link.json()).link?.code;
    ok("the link has a code", !!linkCode, linkCode);

    /* ---- another device cannot touch this merchant ---- */
    const stranger = await get("/api/merchant/me", "someone-else");
    ok("another device does not get this merchant account", stranger.status === 404, String(stranger.status));
    const strangerDelete = await fetch(`${base}/api/merchant/links/${linkCode}`, { method: "DELETE", headers: H("someone-else") });
    ok("…and cannot disable its pay link", strangerDelete.status === 404, String(strangerDelete.status));

    /* ---- changing the settlement number drops verification ---- */
    await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "699111222" });
    const after = await (await get("/api/merchant/me")).json();
    ok("changing the settlement number REVOKES verification — the new one is unproven",
       after.merchant?.verifiedPhone !== true, String(after.merchant?.verifiedPhone));
    const relink = await post("/api/merchant/links", { amountXaf: 100, label: "x" });
    ok("…and pay links are blocked again until it is re-proven", relink.status === 403, String(relink.status));
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();

/* NEXAH BulkSMS — phone number verification only.

   Two things this pins. First, that the adapter reads NEXAH's own envelope honestly: an
   accepted request is not a delivered message, and every documented error code is reported
   rather than swallowed. Second, that the delivery-receipt endpoint cannot be used by a
   stranger to write into our outbox — nothing signs those callbacks, so the secret in the
   path and the message-id match are all there is.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/nexah.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.NEXAH_USER = "momome";
process.env.NEXAH_PASSWORD = "test-password";
process.env.NEXAH_SENDER_ID = "MoMoMe";
process.env.NEXAH_DLR_SECRET = "s3cret-path-segment";
process.env.NEXAH_API_URL = "https://nexah.test/api/v1";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** Every NEXAH call this run made, so the test can assert HOW we called it. */
const calls: Array<{ url: string; method: string; body: string }> = [];
let reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith("https://nexah.test/")) {
    calls.push({ url: u, method: String(init?.method ?? "GET"), body: typeof init?.body === "string" ? init.body : "" });
    const r = reply(u);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }
  return realFetch(url as string, init);
}) as typeof fetch;

async function main() {
  const nexah = await import("../src/adapters/nexah.js");
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const notif = await import("../src/core/notifications.js");

  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const postRaw = (p: string, b: string) => fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: b });

  try {
    console.log("\nThe request we actually send\n");
    reply = () => ({ status: 200, body: { responsecode: 1, responsedescription: "success", sms: [{ messageid: "msg-1", smsclientid: "cli-1", mobileno: "+237677000111", status: "success", errorcode: "", errordescription: "" }] } });
    calls.length = 0;
    let r = await nexah.sendVerificationSms("677000111", "123456 is your MoMo>Me code.");
    ok("a send is accepted and carries NEXAH's message id", r.ok && r.messageId === "msg-1", JSON.stringify(r));
    ok("it is a POST — never the GET form, which puts the password in the URL", calls[0]?.method === "POST" && !calls[0]?.url.includes("password"), `${calls[0]?.method} ${calls[0]?.url}`);
    ok("a local 9-digit number is sent with its country code and no +", JSON.parse(calls[0].body).mobiles === "237677000111", JSON.parse(calls[0].body).mobiles);
    ok("the sender id we registered is what goes out", JSON.parse(calls[0].body).senderid === "MoMoMe");
    ok("a number that already carries a country code is left alone", nexah.msisdn("237699000222") === "237699000222" && nexah.msisdn("+237699000222") === "237699000222");

    console.log("\nAccepted is not delivered, and a refusal is never silent\n");
    reply = () => ({ status: 200, body: { responsecode: 0, responsedescription: "error", responsemessage: "Balance not enough" } });
    r = await nexah.sendVerificationSms("677000111", "x");
    ok("an envelope-level refusal is a failure with the reason", !r.ok && (r.detail ?? "").includes("Balance"), r.detail);
    reply = () => ({ status: 200, body: { responsecode: 1, sms: [{ messageid: "m2", mobileno: "+237000", status: "error", errorcode: -10003 }] } });
    r = await nexah.sendVerificationSms("677000111", "x");
    ok("a per-number error is named from the documented table", !r.ok && r.detail === "invalid mobile number", r.detail);
    reply = () => ({ status: 200, body: { responsecode: 1, sms: [{ messageid: "m3", status: "error", errorcode: -10008 }] } });
    r = await nexah.sendVerificationSms("677000111", "x");
    ok("…including an empty balance", !r.ok && (r.detail ?? "").includes("balance not enough"), r.detail);
    reply = () => ({ status: 500, body: {} });
    r = await nexah.sendVerificationSms("677000111", "x");
    ok("an HTTP failure is reported, not thrown", !r.ok && (r.detail ?? "").includes("500"), r.detail);
    ok("an unknown error code is reported by number rather than guessed at", nexah.describeError(-99999) === "NEXAH error -99999");

    console.log("\nCredit: unknown is not zero\n");
    nexah._resetCreditCache();
    reply = () => ({ status: 200, body: { credit: 6124, accountexpdate: "26/03/2027", balanceexpdate: "07/09/2027" } });
    let c = await nexah.credit(true);
    ok("a credit reading comes back with its expiry", c?.credit === 6124 && c?.balanceExpires === "07/09/2027", JSON.stringify(c));
    nexah._resetCreditCache();
    reply = () => ({ status: 500, body: {} });
    c = await nexah.credit(true);
    ok("a balance we could not read is null — NOT zero, which would read as 'out of credit'", c === null, String(c));
    nexah._resetCreditCache();
    reply = () => ({ status: 200, body: { credit: "not a number" } });
    c = await nexah.credit(true);
    ok("…and so is a nonsense figure", c === null);

    console.log("\nA one-time code goes over NEXAH, and the code is never recorded\n");
    updateSettings({ channels: { ...getSettings().channels, SMS: true, WhatsApp: false } });
    ok("the console reports NEXAH as the sender for verification codes", notif.otpSmsSender() === "nexah", String(notif.otpSmsSender()));
    reply = () => ({ status: 200, body: { responsecode: 1, sms: [{ messageid: "otp-msg-1", mobileno: "+237677000111", status: "success" }] } });
    calls.length = 0;
    const sent = await notif.sendOtp("237677000111", "654321", "verify your number", { prefer: "sms" });
    ok("the code is sent over SMS", sent.sent && sent.via === "sms", JSON.stringify(sent));
    ok("…and the body that went to NEXAH carries the code", JSON.parse(calls[0].body).sms.includes("654321"));
    const rec = notif.listNotifications(5).find((x) => x.kind === "one_time_code");
    ok("the outbox row does NOT contain the code", !!rec && !rec.body.includes("654321"), rec?.body);
    ok("…but it does carry the message id a receipt will refer to", rec?.providerMessageId === "otp-msg-1", rec?.providerMessageId);
    ok("it is 'sent', not yet 'delivered' — acceptance is not arrival", rec?.deliveryStatus === "sent", rec?.deliveryStatus);

    console.log("\nDelivery receipts\n");
    const dlr = (id: string, status: string) => JSON.stringify({ dlrlist: [{ reponsecode: 1, messageid: id, mobileno: "+237677000111", status, submittime: "2026-09-24 10:00:00", senttime: "2026-09-24 10:00:01", deliverytime: "2026-09-24 10:00:03" }] });
    let res = await postRaw("/webhooks/sms/nexah/wrong-secret", dlr("otp-msg-1", "DELIVRD"));
    ok("a receipt with the wrong secret is refused", res.status === 404, String(res.status));
    ok("…and it changed nothing", notif.listNotifications(5).find((x) => x.kind === "one_time_code")?.deliveryStatus === "sent");
    res = await postRaw("/webhooks/sms/nexah/s3cret-path-segment", "not json at all");
    ok("a malformed body is a 400, never a 500", res.status === 400, String(res.status));
    res = await postRaw("/webhooks/sms/nexah/s3cret-path-segment", dlr("a-message-we-never-sent", "DELIVRD"));
    ok("a receipt for an id we never issued is accepted and does nothing", res.status === 200 && (await res.json() as { status: number }).status === 1);
    res = await postRaw("/webhooks/sms/nexah/s3cret-path-segment", dlr("otp-msg-1", "DELIVRD"));
    ok("a DELIVRD for our own message marks it delivered", res.status === 200 && notif.listNotifications(5).find((x) => x.kind === "one_time_code")?.deliveryStatus === "delivered", notif.listNotifications(5).find((x) => x.kind === "one_time_code")?.deliveryStatus);
    ok("NEXAH is answered with status 1, as its spec requires", (await (await postRaw("/webhooks/sms/nexah/s3cret-path-segment", dlr("otp-msg-1", "DELIVRD"))).json() as { status: number }).status === 1);

    // An UNDELIV is the case that matters: a verification flow that looks fine while the
    // code never lands is exactly the failure this rail exists to expose.
    reply = () => ({ status: 200, body: { responsecode: 1, sms: [{ messageid: "otp-msg-2", status: "success" }] } });
    await notif.sendOtp("237699000222", "111222", "verify your number", { prefer: "sms" });
    await postRaw("/webhooks/sms/nexah/s3cret-path-segment", dlr("otp-msg-2", "UNDELIV"));
    const failed = notif.listNotifications(10).find((x) => x.providerMessageId === "otp-msg-2");
    ok("an UNDELIV marks the code as failed, not quietly sent", failed?.deliveryStatus === "failed" && failed?.status === "failed", `${failed?.deliveryStatus}/${failed?.status}`);

    console.log("\nParsing holds to the documented statuses\n");
    ok("an unrecognised status is dropped, never read as delivery", nexah.parseDlr(JSON.stringify({ dlrlist: [{ messageid: "x", status: "PENDING" }] })).length === 0);
    ok("the numeric form in the spec's own example is understood", nexah.parseDlr(JSON.stringify({ dlrlist: [{ messageid: "x", status: 1 }] }))[0]?.status === "delivered");
    ok("a batch is parsed whole", nexah.parseDlr(JSON.stringify({ dlrlist: [{ messageid: "a", status: "DELIVRD" }, { messageid: "b", status: "UNDELIV" }] })).length === 2);
    ok("an entry with no message id is skipped", nexah.parseDlr(JSON.stringify({ dlrlist: [{ status: "DELIVRD" }] })).length === 0);
    ok("a secret of the wrong length is refused without comparing", !nexah.verifyDlrSecret("short") && !nexah.verifyDlrSecret(undefined));
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

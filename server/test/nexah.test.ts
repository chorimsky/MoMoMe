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
process.env.NEXAH_DIAL = "237";

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

    console.log("\nThe operator can prove the account works without spending an SMS\n");
    {
      const { issueToken } = await import("../src/core/adminAuth.js");
      const { createUser } = await import("../src/core/adminUsers.js");
      const A = { "x-admin-token": issueToken({ uid: createUser("sms-checker", "Str0ng-Passw0rd!x", "Super Admin" as never).id, role: "Super Admin" as never }).token };
      const check = async () => (await (await fetch(`${base}/api/admin/notifications/sms-check`, { headers: A })).json()) as { configured: boolean; ok: boolean; credit?: number; message: string; smsChannelOn?: boolean };
      nexah._resetCreditCache();
      reply = () => ({ status: 200, body: { errorcode: 401, message: "Unauthorised" } });
      let ch = await check();
      ok("a wrong credential is found HERE, not by a customer who never gets a code", ch.configured && !ch.ok, JSON.stringify(ch));
      ok("…and the message points at the usual cause", /Unauthorised|user or password/i.test(ch.message), ch.message);
      nexah._resetCreditCache();
      reply = () => ({ status: 200, body: { credit: 4000 } });
      ch = await check();
      ok("a working account reports its credit", ch.ok && ch.credit === 4000, JSON.stringify(ch));
      ok("…and never returns the credential itself", !JSON.stringify(ch).includes("test-password"));
      // SMS switched off in Settings is the other way a working account sends nothing.
      updateSettings({ channels: { ...getSettings().channels, SMS: false } });
      nexah._resetCreditCache();
      ch = await check();
      ok("working credentials with the channel switched off say so plainly", /switched OFF/i.test(ch.message), ch.message);
      updateSettings({ channels: { ...getSettings().channels, SMS: true } });
      /* A placeholder is worse than a missing value: non-empty, so every "is it set?" check
         passes, and then the provider refuses every single send. This exact shape happened —
         `--set NEXAH_PASSWORD='<your rotated password>'` quoted the instruction, so the shell
         stored it verbatim. `config` snapshots the environment at module load, so the
         predicate is what is asserted here; nexahConfigured() composes it over those values. */
      const { looksLikePlaceholder } = await import("../src/config.js");
      ok("a bracketed placeholder is not a credential", looksLikePlaceholder("<your rotated password>"));
      // Both of these were set on a real deployment from a copied command. The first version
      // of this check only matched a LEADING keyword, so the second one sailed through it.
      ok("…and neither is an instruction anywhere in the phrase", looksLikePlaceholder("replace-with-your-rotated-password") && looksLikePlaceholder("paste-the-real-password-here"));
      ok("…nor 'change me', a TODO or an example, hyphen- or underscore-joined", looksLikePlaceholder("change-me") && looksLikePlaceholder("TODO_here") && looksLikePlaceholder("replace_with_your_password") && looksLikePlaceholder("example secret"));
      ok("a real secret is NOT mistaken for one, however punctuated", !looksLikePlaceholder("Demo2000@$&") && !looksLikePlaceholder("k3Yr-8f2!x_qz") && !looksLikePlaceholder("xK9-mQ2_vB7"), "");
      ok("…and neither is an email login, even at example.com", !looksLikePlaceholder("rimskycho@gmail.com") && !looksLikePlaceholder("someone@example.com"));
      ok("an empty value is missing, not a placeholder", !looksLikePlaceholder(""));

      const anonC = await fetch(`${base}/api/admin/notifications/sms-check`);
      ok("the check is operator-only", anonC.status === 401 || anonC.status === 403, String(anonC.status));
    }

    console.log("\nThe console blames the right thing\n");
    {
      // The failure that actually happened: every NEXAH variable set correctly, and the
      // console still said "nobody can verify a number. Set NEXAH_USER / NEXAH_PASSWORD /
      // NEXAH_SENDER_ID" — sending an operator to re-check credentials that were fine,
      // because the provider and the Settings switch were folded into one boolean.
      updateSettings({ channels: { ...getSettings().channels, SMS: false, WhatsApp: false } });
      let h = notif.notificationHealth();
      ok("with the switch off, nothing can carry a code", !h.otp.sms && !h.otp.whatsapp);
      ok("…but the provider is reported as READY, separately from the switch", h.otp.smsProviderReady === true && h.otp.smsChannelOn === false, JSON.stringify({ ready: h.otp.smsProviderReady, on: h.otp.smsChannelOn }));
      updateSettings({ channels: { ...getSettings().channels, SMS: true } });
      h = notif.notificationHealth();
      ok("switching it on is all it takes — no credential change", h.otp.sms === true && h.otp.smsChannelOn === true);
      ok("…and the sender is named", h.otp.smsSender === "nexah", String(h.otp.smsSender));
    }

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

    console.log("\nA hosted deployment that answers a rejection with HTTP 200\n");
    // sms.wandatech.net serves the same API at /api/v1 and answers a bad credential with
    // {"errorcode":401,"message":"Unauthorised"} and a 200 status — no responsecode at all.
    // Read as the documented envelope that became a bare "refused the request".
    nexah._resetCreditCache();
    reply = () => ({ status: 200, body: { errorcode: 401, message: "Unauthorised" } });
    const un = await nexah.sendVerificationSms("677000111", "x");
    ok("a 200-with-errorcode rejection is a failure, never a success", !un.ok, JSON.stringify(un));
    ok("…and it carries the word that says what is wrong", (un.detail ?? "").includes("Unauthorised") && (un.detail ?? "").includes("401"), un.detail);
    const uc = await nexah.credit(true);
    ok("the same shape on the credit endpoint reads as UNKNOWN, not zero credit", uc === null, String(uc));

    console.log("\nThe API base is taken as given, whatever the deployment's path\n");
    calls.length = 0;
    reply = () => ({ status: 200, body: { responsecode: 1, sms: [{ messageid: "m9", status: "success" }] } });
    await nexah.sendVerificationSms("677000111", "x");
    ok("a base that already names its version is used unchanged", calls[0]?.url === "https://nexah.test/api/v1/sendsms", calls[0]?.url);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

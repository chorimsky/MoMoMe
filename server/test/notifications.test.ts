/* Notifications — say what is actually being sent.

   The admin console has always carried a card headed "Notification channels — how customers
   receive transfer updates", with Email and SMS switched ON. Nothing on the server ever read
   that setting; there was no email or SMS provider in the dependency tree to read it with. An
   operator looking at that screen had every reason to believe recipients were being told
   their money had arrived. Nobody was told anything.

   Two properties are load-bearing here. A channel switched ON with no provider behind it must
   record a SKIP with that reason, because the failure being fixed is a console that implies
   delivery it isn't doing — silence would just move the lie. And dispatch must never be able
   to fail a payment: a delivered payment is delivered whether or not a gateway answered. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
delete process.env.SMS_WEBHOOK_URL;

import type { Payment } from "../../shared/types.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const { notify, notifyDelivered, listNotifications, notificationHealth } =
  await import("../src/core/notifications.js");
const { updateSettings, getSettings } = await import("../src/core/settings.js");

const now = new Date().toISOString();
const pay = (over: Partial<Payment> = {}): Payment => ({
  id: "pay_n1", ref: "MMM-2026-418844", quoteId: "q1", state: "DELIVERED", displayStatus: "Completed",
  method: "LIGHTNING",
  recipient: { phone: "680344485", country: "CM", provider: "MTN", name: "", nameSource: "manual" },
  xaf: 500, feeXaf: 3, totalXaf: 503, usd: 0.8,
  payInstruction: { method: "LIGHTNING", code: "ln", qr: "lightning:ln", asset: "BTC", amount: 0.0001,
    amountLabel: "11 991 sats", expiresAt: now, providerRef: "ph", provider: "ibex" },
  events: [], createdAt: now, updatedAt: now, ...over,
} as Payment);

console.log("\nNotifications — say what is actually being sent\n");

/* ---- SMS enabled in settings, no provider: the console must SAY so ---- */
updateSettings({ channels: { ...getSettings().channels, SMS: true } });
await notifyDelivered(pay());

const afterDeliver = listNotifications();
const smsRec = afterDeliver.find((r) => r.channel === "sms");
ok("a delivery attempts the recipient over SMS", !!smsRec, smsRec?.channel);
ok("…and is SKIPPED, not silently dropped", smsRec?.status === "skipped", smsRec?.status);
ok("with a reason an operator can act on",
   !!smsRec?.detail && /no provider is configured/i.test(smsRec.detail), smsRec?.detail);
ok("the message says what the recipient needs to know",
   !!smsRec && smsRec.body.includes("500 XAF") && smsRec.body.includes("MMM-2026-418844"), smsRec?.body);
ok("it is addressed to the recipient's international number", smsRec?.to === "+237680344485", smsRec?.to);

/* ---- switched OFF is a different reason from NOT WIRED ---- */
updateSettings({ channels: { ...getSettings().channels, SMS: false } });
await notifyDelivered(pay({ ref: "MMM-2026-418845" }));
const offRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418845" && r.channel === "sms");
ok("a channel turned off records that, not a provider fault",
   offRec?.status === "skipped" && /Turned off/i.test(offRec.detail ?? ""), offRec?.detail);
updateSettings({ channels: { ...getSettings().channels, SMS: true } });

/* ---- a configured provider actually sends ---- */
const calls: Array<{ url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  calls.push({ url: String((input as { url?: string })?.url ?? input), body: JSON.parse(init?.body ?? "{}") });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
process.env.SMS_WEBHOOK_URL = "https://gateway.test/send";

await notifyDelivered(pay({ ref: "MMM-2026-418846" }));
const sentRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418846" && r.channel === "sms");
ok("with a provider configured it is SENT", sentRec?.status === "sent", `${sentRec?.status} ${sentRec?.detail ?? ""}`);
ok("…and stamped with when", !!sentRec?.sentAt);
ok("the gateway was called once", calls.length === 1, `${calls.length} call(s)`);
ok("with the destination and message", (calls[0]?.body as { to?: string; message?: string })?.to === "+237680344485"
   && !!(calls[0]?.body as { message?: string })?.message, JSON.stringify(calls[0]?.body).slice(0, 70));

/* ---- a gateway failure is recorded, and never reaches the caller ---- */
globalThis.fetch = (async () => new Response("upstream down", { status: 502 })) as typeof fetch;
let threw = false;
try { await notifyDelivered(pay({ ref: "MMM-2026-418847" })); } catch { threw = true; }
ok("a failing gateway does NOT throw at the money path", !threw);
const failRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418847" && r.channel === "sms");
ok("the failure is recorded", failRec?.status === "failed", failRec?.status);
ok("with the gateway's own answer", /502/.test(failRec?.detail ?? ""), failRec?.detail);

globalThis.fetch = (async () => { throw new Error("socket hang up"); }) as typeof fetch;
threw = false;
try { await notifyDelivered(pay({ ref: "MMM-2026-418848" })); } catch { threw = true; }
ok("a channel that THROWS is contained too", !threw);
ok("and recorded as failed",
   listNotifications().find((r) => r.paymentRef === "MMM-2026-418848" && r.channel === "sms")?.status === "failed");
globalThis.fetch = realFetch;
delete process.env.SMS_WEBHOOK_URL;

/* ---- an audience we cannot reach must say so, not pretend ----
   We hold no contact details for a sender — the account IS the device, there is no sign-up. */
await notify({ kind: "payment_failed", audience: "sender", body: "your payment failed" });
const senderRec = listNotifications()[0];
ok("a message to the sender is skipped, because nothing can reach them",
   senderRec.audience === "sender" && senderRec.status === "skipped", senderRec.status);
ok("…and says why rather than implying it was sent",
   /no contact details/i.test(senderRec.detail ?? ""), senderRec.detail);

/* ---- operator messages always land, so the pipeline is never a no-op ---- */
await notify({ kind: "unattributed_inbound", audience: "operator", body: "unattributed 0.0004 BTC" });
ok("an operator message is delivered via the log channel",
   listNotifications()[0].status === "sent" && listNotifications()[0].channel === "log");

/* ---- the health summary is what the console renders ---- */
const h = notificationHealth();
ok("health counts every outcome", h.total > 0 && h.sent > 0 && h.skipped > 0 && h.failed > 0,
   `sent ${h.sent} / failed ${h.failed} / skipped ${h.skipped}`);
const sms = h.channels.find((c) => c.name === "sms");
ok("it reports SMS as enabled but unconfigured — the exact state the console misrepresented",
   sms?.enabled === true && sms?.configured === false, JSON.stringify(sms));
ok("and which audience each channel can actually reach", sms?.reaches.includes("recipient") === true,
   sms?.reaches.join(","));

/* ---- PUSH: the only channel that reaches a SENDER ---- */
{
  const { setPushToken, clearPushToken, pushTokenFor } = await import("../src/core/pushTokens.js");
  const sent: Array<{ to: string; title: string; body: string }> = [];
  let ticket: { status: string; details?: { error?: string } } = { status: "ok" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.startsWith("https://exp.host/--/api/v2/push/send")) {
      const msgs = JSON.parse(String((init as { body?: string })?.body ?? "[]")) as Array<{ to: string; title: string; body: string }>;
      sent.push(...msgs);
      return new Response(JSON.stringify({ data: msgs.map(() => ticket) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input as RequestInfo, init as RequestInit);
  }) as typeof fetch;

  // No token yet → the sender is unreachable, and the outbox says so.
  await notifyDelivered(pay({ ref: "MMM-2026-418850", senderId: "dev_abc" }));
  const noTok = listNotifications().find((r) => r.paymentRef === "MMM-2026-418850" && r.channel === "push");
  ok("a delivery ALSO addresses the sender over push", !!noTok, noTok?.audience);
  ok("…and without a token records WHY nothing was sent (skipped, not a gateway fault)", noTok?.status === "skipped" && /not turned on payment alerts/.test(noTok.detail ?? ""), noTok?.detail);

  // Token registered (French) → a real push goes out, in French, with the essentials.
  setPushToken("dev_abc", "ExponentPushToken[abcdefgh12345678]", "android", "fr");
  await notifyDelivered(pay({ ref: "MMM-2026-418851", senderId: "dev_abc", recipient: { phone: "680344485", country: "CM", provider: "MTN", name: "NANA JEAN PAUL", nameSource: "provider" } }));
  const m = sent[sent.length - 1];
  ok("push sent to the registered token", m?.to === "ExponentPushToken[abcdefgh12345678]", m?.to);
  ok("…in the device's language, naming amount, person and ref", m?.title === "Livré ✓" && /500 XAF/.test(m.body) && /NANA JEAN PAUL/.test(m.body) && /MMM-2026-418851/.test(m.body), `${m?.title} | ${m?.body}`);
  const okRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418851" && r.channel === "push");
  ok("outbox records it as sent", okRec?.status === "sent", okRec?.status);

  // A refund-to-claim is pushed too — that is the message a sender most needs.
  const { notifyPayoutFailed } = await import("../src/core/notifications.js");
  await notifyPayoutFailed(pay({ ref: "MMM-2026-418852", senderId: "dev_abc" }), "rail rejected");
  const rf = sent[sent.length - 1];
  ok("a failed payout pushes 'claim your refund' to the sender", /remboursement/i.test(rf?.body ?? "") && /MMM-2026-418852/.test(rf?.body ?? ""), rf?.body);

  // Lightning-Address payments have no app sender: nothing is pushed, nothing is faked.
  const before = sent.length;
  await notifyDelivered(pay({ ref: "MMM-2026-418853", senderId: "lnurl:237680344485@momome.xyz" }));
  ok("an LNURL payment (no app) pushes nothing", sent.length === before);

  // The push service says the device is gone → the token is dropped, not retried forever.
  ticket = { status: "error", details: { error: "DeviceNotRegistered" } };
  await notifyDelivered(pay({ ref: "MMM-2026-418854", senderId: "dev_abc" }));
  ok("DeviceNotRegistered drops the token", pushTokenFor("dev_abc") === undefined);

  // Turned off in Settings → skipped with that reason.
  setPushToken("dev_abc", "ExponentPushToken[abcdefgh12345678]", "ios", "en");
  updateSettings({ channels: { ...getSettings().channels, Push: false } });
  await notifyDelivered(pay({ ref: "MMM-2026-418855", senderId: "dev_abc" }));
  const off = listNotifications().find((r) => r.paymentRef === "MMM-2026-418855" && r.channel === "push");
  ok("Push switched off in Settings → skipped, with that reason", off?.status === "skipped" && /Turned off/.test(off.detail ?? ""), off?.detail);
  updateSettings({ channels: { ...getSettings().channels, Push: true } });
  clearPushToken("dev_abc");
  const hp = notificationHealth().channels.find((c) => c.name === "push");
  ok("health lists push as reaching the sender, with a device count", hp?.reaches.join(",") === "sender" && hp?.devices === 0, JSON.stringify(hp));
  globalThis.fetch = realFetch;
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

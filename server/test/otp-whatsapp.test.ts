/* One-time codes over WhatsApp — merchant number verification, "own your number", account
   claim. WhatsApp first (an AUTHENTICATION template with the copy-code button), SMS as the
   fallback, the person's preference honoured, the code never written down.

   Before this, a code went through notify(): the WhatsApp channel would have sent it as a
   "manual_review" notice — a template with amount/reference slots and no place for a code —
   and the SMS was then skipped as "already delivered over WhatsApp". A merchant on WhatsApp
   got a blank review notice and no code.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/otp-whatsapp.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
process.env.WHATSAPP_TEMPLATE_OTP = "momome_otp";
process.env.WHATSAPP_TEMPLATE_LANG_FR = "fr";
process.env.SMS_WEBHOOK_URL = "https://sms.test/send";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type WaCall = { to: string; type: string; template?: string; lang?: string; body?: string[]; button?: string[]; text?: string };
let wa: WaCall[] = [];
let sms: Array<{ to: string; message: string }> = [];
let waDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://sms.test")) { sms.push(JSON.parse(init?.body ?? "{}")); return J({ ok: true }); }
  if (url.includes("graph.facebook.com")) {
    if (waDown) return J({ error: { message: "(#131026) Message undeliverable", code: 131026 } }, 400);
    const b = JSON.parse(init?.body ?? "{}") as { to: string; type: string; text?: { body: string }; template?: { name: string; language: { code: string }; components: Array<{ type: string; parameters: Array<{ text: string }> }> } };
    wa.push({
      to: b.to, type: b.type, text: b.text?.body, template: b.template?.name, lang: b.template?.language.code,
      body: b.template?.components.find((c) => c.type === "body")?.parameters.map((p) => p.text),
      button: b.template?.components.find((c) => c.type === "button")?.parameters.map((p) => p.text),
    });
    return J({ messages: [{ id: `wamid.${wa.length}` }] });
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { listNotifications, notificationHealth, otpChannels } = await import("../src/core/notifications.js");
  const { getSettings, updateSettings } = await import("../src/core/settings.js");
  // The Settings switch is the operator's; the channel is OFF until they turn it on.
  ok("WhatsApp is not an OTP channel while switched off in Settings", otpChannels().whatsapp === false, JSON.stringify(otpChannels()));
  updateSettings({ channels: { ...getSettings().channels, WhatsApp: true, SMS: true } });
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "merchant-device" };
  const post = async (p: string, b: unknown) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) });
  const reset = () => { wa = []; sms = []; waDown = false; };

  try {
    console.log("\nOne-time codes over WhatsApp\n");

    ok("both channels are available", otpChannels().whatsapp && otpChannels().sms, JSON.stringify(otpChannels()));
    const h = notificationHealth();
    ok("the console can see where codes go", h.otp.whatsapp && h.otp.sms && h.otp.whatsappTemplate, JSON.stringify(h.otp));

    const created = await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "677000789" });
    ok("merchant created", created.status === 201, String(created.status));
    ok("…and the reply says a code can go by WhatsApp", (await created.json()).otpChannels?.whatsapp === true);

    /* ---- default: WhatsApp, as an authentication template ---- */
    reset();
    let r = await post("/api/merchant/verify/request", { lang: "en" });
    let b = await r.json();
    ok("the code goes over WhatsApp by default", b.sent === true && b.via === "whatsapp" && wa.length === 1 && sms.length === 0, `via=${b.via} wa=${wa.length} sms=${sms.length}`);
    ok("…as the AUTHENTICATION template, not a notice template", wa[0]?.type === "template" && wa[0]?.template === "momome_otp", `${wa[0]?.type}/${wa[0]?.template}`);
    ok("…to the merchant's number in WhatsApp digits form", wa[0]?.to === "237677000789", wa[0]?.to);
    const code = wa[0]?.body?.[0] ?? "";
    ok("…with the code in the body slot", /^\d{6}$/.test(code), code);
    ok("…and again on the copy-code button", wa[0]?.button?.[0] === code, wa[0]?.button?.[0]);
    ok("…in the default language", wa[0]?.lang === "en", wa[0]?.lang);
    ok("the reply tells the client which channels exist", b.channels?.whatsapp === true && b.channels?.sms === true, JSON.stringify(b.channels));
    const rec = listNotifications().find((n) => n.kind === "one_time_code");
    ok("the outbox records a code went by WhatsApp", rec?.channel === "whatsapp" && rec?.status === "sent", `${rec?.channel}/${rec?.status}`);
    ok("…but never the code itself", !!rec && !rec.body.includes(code), rec?.body);

    /* ---- French → the French template language ---- */
    reset();
    r = await post("/api/merchant/verify/request", { lang: "fr" });
    ok("a French user gets the French template", (await r.json()).via === "whatsapp" && wa[0]?.lang === "fr", wa[0]?.lang);

    /* ---- the person prefers SMS ---- */
    reset();
    r = await post("/api/merchant/verify/request", { via: "sms" });
    b = await r.json();
    ok("'send by SMS instead' is honoured", b.via === "sms" && sms.length === 1 && wa.length === 0, `via=${b.via} sms=${sms.length} wa=${wa.length}`);
    ok("…to the international number", sms[0]?.to === "+237677000789", sms[0]?.to);

    /* ---- WhatsApp refuses (not a WhatsApp number) → SMS fallback, same request ---- */
    // A fresh settlement number: the per-phone code budget above is the anti-bombing guard
    // and this test has already spent three codes on the first one.
    await post("/api/merchant", { businessName: "Chez Alice", country: "CM", settlementPhone: "699111222" });
    reset(); waDown = true;
    r = await post("/api/merchant/verify/request", {});
    b = await r.json();
    ok("when WhatsApp cannot deliver, the SMS goes out in the same request", b.sent === true && b.via === "sms" && sms.length === 1, `via=${b.via} sms=${sms.length}`);
    const failed = listNotifications().find((n) => n.kind === "one_time_code" && n.status === "failed");
    ok("…and the WhatsApp failure is written down with Meta's reason", /131026/.test(failed?.detail ?? ""), failed?.detail);

    /* ---- the code that arrived verifies the merchant ---- */
    const smsCode = (sms[0].message.match(/\d{6}/) ?? [])[0]!;
    const v = await post("/api/merchant/verify", { code: smsCode });
    ok("the code that was delivered verifies the number", v.status === 200 && (await v.json()).merchant?.verifiedPhone === true, String(v.status));

    /* ---- the other two OTP flows take the same preference ---- */
    reset();
    r = await post("/api/me/anchor/request", { phone: "699333444", lang: "fr" });
    b = await r.json();
    ok("'own your number' also goes over WhatsApp", b.via === "whatsapp" && wa[0]?.template === "momome_otp" && wa[0]?.lang === "fr", `via=${b.via}`);

    /* ---- without a WhatsApp template, WhatsApp is not an OTP channel at all ---- */
    process.env.WHATSAPP_TEMPLATE_OTP = "";
    const { config } = await import("../src/config.js");
    (config.whatsapp as { templateOtp: string }).templateOtp = "";
    ok("no authentication template → WhatsApp is not offered for codes", otpChannels().whatsapp === false && otpChannels().sms === true, JSON.stringify(otpChannels()));
    reset();
    r = await post("/api/me/anchor/request", { phone: "699555666" });
    b = await r.json();
    ok("…and the code goes by SMS, never as a notice template", b.via === "sms" && wa.length === 0, `via=${b.via} wa=${wa.length}`);
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

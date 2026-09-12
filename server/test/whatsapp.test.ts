/* WhatsApp — text and voice on our number turned into transactions, and a channel that
   respects Meta's 24 h rule. Only Meta's HTTP surface is faked.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/whatsapp.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.WHATSAPP_APP_SECRET = "app-secret";
process.env.WHATSAPP_TEMPLATE_DELIVERED = "momome_delivered";
process.env.WHATSAPP_TEMPLATE_REFUND = "momome_refund";
process.env.WHATSAPP_TEMPLATE_LANG_FR = "fr";
process.env.WEB_ORIGIN = "https://momome.xyz";
process.env.META_AI_API_KEY = "test-meta-key";
delete process.env.SMS_WEBHOOK_URL;

import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import type { Payment } from "../../shared/types.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const sent: Array<{ to: string; type: string; text?: string; template?: string; params?: string[]; lang?: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://api.meta.ai/v1/chat/completions")) {
    aiCalls++;
    if (aiDown) return new Response("upstream", { status: 503 });
    const b = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
    const user = b.messages.find((m) => m.role === "user")?.content.toLowerCase() ?? "";
    const hit = INTENTS[user];
    return hit ? J({ choices: [{ message: { content: JSON.stringify(hit) } }] }) : J({ choices: [{ message: { content: JSON.stringify({ intent: "other", amount_xaf: null, number: null, ref: null, language: "en" }) } }] });
  }
  if (url.startsWith("https://api.meta.ai/v1/asr/transcribe")) {
    asrCalls++;
    const form = (init as { body?: FormData })?.body;
    const audio = form?.get("audio") as Blob | null;
    const head = Buffer.from(await (audio?.slice(0, 4).arrayBuffer() ?? new ArrayBuffer(0))).toString("ascii");
    if (head !== "RIFF") return new Response(JSON.stringify({ error: "not wav" }), { status: 400 });
    return J({ transcript: "envoie cinq mille à six sept sept zéro zéro zéro sept huit neuf", audioDurationMs: 3200 });
  }
  if (url === "https://graph.facebook.com/v21.0/media-voice-1") return J({ url: "https://lookaside.example/voice.ogg", mime_type: "audio/ogg", file_size: 12000 });
  if (url === "https://lookaside.example/voice.ogg") { mediaDownloads++; return new Response(new Uint8Array(await import("node:fs").then((fs) => fs.promises.readFile("test/fixtures/voice.ogg")))); }
  if (url.includes("graph.facebook.com")) {
    const b = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as { to: string; type: string; text?: { body: string }; template?: { name: string; components?: Array<{ parameters: Array<{ text: string }> }> }; status?: string };
    if (b.status === "read") return J({ success: true });
    sent.push({ to: b.to, type: b.type, text: b.text?.body, template: b.template?.name, params: b.template?.components?.[0]?.parameters.map((p) => p.text), lang: (b.template as { language?: { code?: string } } | undefined)?.language?.code });
    return J({ messages: [{ id: `wamid.${sent.length}` }] });
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

/* Fake Meta Model API: intent JSON for known phrases (null → regex fallback), ASR transcript
   for the voice note. Set `aiDown` to simulate an outage. */
let aiDown = false;
let aiCalls = 0, asrCalls = 0;
let mediaDownloads = 0;
const INTENTS: Record<string, unknown> = {
  "give nana 5k for the rent, her number is 6 77 00 07 89": { intent: "send", amount_xaf: 5000, number: "677000789", ref: null, language: "en" },
  "envoie cinq mille à six sept sept zéro zéro zéro sept huit neuf": { intent: "send", amount_xaf: 5000, number: "677000789", ref: null, language: "fr" },
  "c'est quoi momome ?": { intent: "help", amount_xaf: null, number: null, ref: null, language: "fr" },
};
const meta = (from: string, msg: Record<string, unknown>) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from, id: "wamid.in", ...msg }] } }] }] });
const sign = (raw: string) => "sha256=" + createHmac("sha256", "app-secret").update(raw).digest("hex");

async function main() {
  const { createApp } = await import("../src/app.js");
  const { replyTo, parseAmount, detectLang } = await import("../src/core/whatsappBot.js");
  const { notifyDelivered, listNotifications } = await import("../src/core/notifications.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { inReplyWindow } = await import("../src/core/whatsapp.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    console.log("\nWhatsApp — chat in, transaction link out\n");
    ok("amount parser: 5 000 / 5k / 2,5k", parseAmount("5 000") === 5000 && parseAmount("5k") === 5000 && parseAmount("2,5k") === 2500, `${parseAmount("5 000")} ${parseAmount("5k")} ${parseAmount("2,5k")}`);
    ok("language follows the verb", detectLang("envoyer 5000 à 677000789") === "fr" && detectLang("send 5000 to 677000789") === "en");

    let r = await replyTo({ from: "237699000111", kind: "text", text: "send 5000 to 677000789" });
    ok("send → a pay link with the number and amount", r.includes("https://momome.xyz/send?to=237677000789&amount=5000"), r.split("\n")[1]);
    ok("…and the registered name, before they tap", /Pay \*5 000 XAF\* to \*[A-Z ]+ · MTN 677000789\*/.test(r) || /name not on file/.test(r), r.split("\n")[0]);
    r = await replyTo({ from: "237699000111", kind: "text", text: "envoyer 2500 à 6 77 00 07 89" });
    ok("French, spaced digits → French reply, same link", r.startsWith("Payer") && r.includes("to=237677000789&amount=2500"), r.split("\n")[0]);
    r = await replyTo({ from: "237699000111", kind: "text", text: "send 5000 to 12345" });
    ok("a bad number is refused with the reason", /not a Mobile Money number/.test(r));
    r = await replyTo({ from: "237699000111", kind: "text", text: "send 10 to 677000789" });
    ok("an amount below the minimum is refused", /between/.test(r));
    r = await replyTo({ from: "237699000111", kind: "text", text: "receive 15000" });
    ok("receive → the sender's own receive link (their WhatsApp number)", r.includes("https://momome.xyz/send?to=237699000111&amount=15000"), r.split("\n")[1]);
    r = await replyTo({ from: "15551234567", kind: "text", text: "my link" });
    ok("a WhatsApp number that is not Mobile Money cannot get a receive link", /does not look like a Mobile Money number/.test(r));
    r = await replyTo({ from: "237699000111", kind: "audio" });
    ok("a voice note gets a plain 'type it' reply in both languages", /voice notes/.test(r) && /notes vocales/.test(r));
    r = await replyTo({ from: "237699000111", kind: "text", text: "hello" });
    ok("anything else → the menu", /send 5000 to 677000789/.test(r));
    r = await replyTo({ from: "237699000111", kind: "text", text: "status MMM-2026-999999" });
    ok("unknown ref → says so", /no payment MMM-2026-999999/.test(r));

    // Webhook: verification handshake + signed inbound → bot reply sent through the API.
    let res = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123`);
    ok("Meta verification handshake echoes the challenge", res.status === 200 && (await res.text()) === "abc123");
    res = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
    ok("…and refuses a wrong verify token", res.status === 403);
    const raw = meta("237699000111", { type: "text", text: { body: "send 1000 to 677000789" } });
    res = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" }, body: raw });
    ok("an unsigned/badly signed payload is refused", res.status === 401, String(res.status));
    res = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) }, body: raw });
    ok("a signed payload is acked fast", res.status === 200);
    await wait(800);
    const reply = sent.find((m) => m.to === "237699000111" && m.type === "text");
    ok("…and the bot's reply went out over the Cloud API", !!reply && /to=237677000789&amount=1000/.test(reply.text ?? ""), reply?.text?.split("\n")[1]);
    ok("the person is now inside the 24 h reply window", inReplyWindow("237699000111"));

    // Channel: delivery notice to the RECIPIENT — text inside the window, template outside.
    updateSettings({ channels: { ...getSettings().channels, WhatsApp: true, SMS: true } });
    const now = new Date().toISOString();
    const pay = (over: Partial<Payment>): Payment => ({ id: "pay_w1", ref: "MMM-2026-418900", quoteId: "q", state: "DELIVERED", displayStatus: "Completed", method: "LIGHTNING",
      recipient: { phone: "699000111", country: "CM", provider: "MTN", name: "", nameSource: "manual" }, xaf: 1000, feeXaf: 25, totalXaf: 1025, usd: 1.7,
      payInstruction: { method: "LIGHTNING", code: "ln", qr: "q", asset: "BTC", amount: 0.00002, amountLabel: "x", expiresAt: now, providerRef: "p", provider: "ibex" },
      events: [], createdAt: now, updatedAt: now, ...over } as Payment);
    sent.length = 0;
    await notifyDelivered(pay({}));
    const wa = sent.find((m) => m.to === "237699000111");
    ok("recipient inside the window gets a free-form WhatsApp text", wa?.type === "text" && /1 000 XAF/.test(wa.text ?? ""), wa?.text);
    const smsRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418900" && r.channel === "sms");
    ok("…and the SMS is skipped as redundant (cost)", smsRec?.status === "skipped" && /Already delivered over WhatsApp/.test(smsRec.detail ?? ""), smsRec?.detail);

    sent.length = 0;
    await notifyDelivered(pay({ ref: "MMM-2026-418901", recipient: { phone: "677000598", country: "CM", provider: "MTN", name: "", nameSource: "manual" } }));
    const tpl = sent.find((m) => m.to === "237677000598");
    ok("recipient OUTSIDE the window gets the approved template with amount + ref", tpl?.type === "template" && tpl.template === "momome_delivered" && tpl.params?.[0] === "1 000 XAF" && tpl.params?.[1] === "MMM-2026-418901", JSON.stringify(tpl));
    const tplRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418901" && r.channel === "whatsapp");
    ok("the outbox keeps the provider's message id and a 'sent' delivery state", !!tplRec?.providerMessageId && tplRec.deliveryStatus === "sent", `${tplRec?.providerMessageId} ${tplRec?.deliveryStatus}`);

    // Delivery receipts: Meta tells us delivered / read / failed for OUR messages.
    const statusBody = (id: string, status: string, errors?: unknown[]) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id, status, recipient_id: "237677000598", ...(errors ? { errors } : {}) }] } }] }] });
    let sb = statusBody(tplRec!.providerMessageId!, "read");
    await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(sb) }, body: sb });
    await wait(300);
    ok("a 'read' receipt updates the record", listNotifications().find((r) => r.id === tplRec!.id)?.deliveryStatus === "read");
    sb = statusBody(tplRec!.providerMessageId!, "delivered");
    await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(sb) }, body: sb });
    await wait(300);
    ok("…and a late 'delivered' never regresses 'read'", listNotifications().find((r) => r.id === tplRec!.id)?.deliveryStatus === "read");
    // A refund notice OUTSIDE the window uses the refund template, in French when the body is French.
    const { linkDevice } = await import("../src/core/account.js");
    linkDevice("dev-fr-sender", "237699000555"); // sender anchored → reachable on WhatsApp
    const { notifyPayoutFailed } = await import("../src/core/notifications.js");
    const { setPushToken: setTok } = await import("../src/core/pushTokens.js");
    setTok("dev-fr-sender", "ExponentPushToken[frfrfrfrfrfrfrfr]", "android", "fr"); // language = fr
    sent.length = 0;
    await notifyPayoutFailed(pay({ ref: "MMM-2026-418902", senderId: "dev-fr-sender" }), "rail rejected");
    const rt = sent.find((m) => m.to === "237699000555");
    ok("a refund notice outside the window uses the REFUND template in French", rt?.type === "template" && rt.template === "momome_refund" && rt.lang === "fr", JSON.stringify(rt));
    // The failure receipt for a message marks the outbox record failed with Meta's reason.
    const refRec = listNotifications().find((r) => r.paymentRef === "MMM-2026-418902" && r.channel === "whatsapp");
    sb = statusBody(refRec!.providerMessageId!, "failed", [{ code: 131047, title: "Re-engagement message", message: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." }]);
    await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(sb) }, body: sb });
    await wait(300);
    const failedRec = listNotifications().find((r) => r.id === refRec!.id);
    ok("a 'failed' receipt marks the record failed with Meta's reason", failedRec?.status === "failed" && /131047/.test(failedRec.detail ?? ""), failedRec?.detail);

    // ---- Meta Model API: understanding, then the same checks ----
    console.log("\nMeta Model API — the model proposes, the code disposes\n");
    r = await replyTo({ from: "237699000111", kind: "text", text: "Give Nana 5k for the rent, her number is 6 77 00 07 89" });
    ok("free text the regex cannot read → the model's intent → a pay link", r.includes("to=237677000789&amount=5000"), r.split("\n")[1]);
    r = await replyTo({ from: "237699000111", kind: "text", text: "envoie cinq mille à six sept sept zéro zéro zéro sept huit neuf" });
    ok("numbers and amounts dictated in words → digits → French reply", r.startsWith("Payer") && r.includes("to=237677000789&amount=5000"), r.split("\n")[0]);
    r = await replyTo({ from: "237699000111", kind: "text", text: "C'est quoi MoMoMe ?" });
    ok("a question → the menu in French", r.startsWith("MoMo›Me sur WhatsApp"));
    const before = aiCalls;
    aiDown = true;
    r = await replyTo({ from: "237699000111", kind: "text", text: "send 3000 to 677000789" });
    ok("model outage → the regex bot still answers", r.includes("to=237677000789&amount=3000") && aiCalls === before + 1, r.split("\n")[1]);
    aiDown = false;

    // A voice note: downloaded, converted to WAV, transcribed, read back, answered.
    const fs = await import("node:fs");
    if (fs.existsSync("test/fixtures/voice.ogg")) {
      r = await replyTo({ from: "237699000111", kind: "audio", mediaId: "media-voice-1" });
      ok("voice note → downloaded → WAV → transcribed", mediaDownloads === 1 && asrCalls === 1, `downloads=${mediaDownloads} asr=${asrCalls}`);
      ok("…what we heard is read back before the link", /J'ai entendu : « envoie cinq mille/.test(r), r.split("\n")[0]);
      ok("…and the link is for the dictated number and amount", r.includes("to=237677000789&amount=5000"));
      ok("…with an out if we misheard", /Si ce n'est pas ça, écrivez-le/.test(r));
    } else {
      console.log("  (no test/fixtures/voice.ogg — voice path not exercised)");
    }
    const { wav16 } = await import("../src/core/audio.js");
    const w = wav16(new Int16Array([0, 1000, -1000, 0]), 16000);
    ok("WAV encoder: RIFF header, mono 16-bit 16 kHz, correct sizes", w.toString("ascii", 0, 4) === "RIFF" && w.readUInt16LE(22) === 1 && w.readUInt32LE(24) === 16000 && w.readUInt16LE(34) === 16 && w.readUInt32LE(40) === 8);
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

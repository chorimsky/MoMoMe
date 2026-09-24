/* WhatsApp configured, but WHATSAPP_APP_SECRET missing — the door that used to be open.

   The webhook verified Meta's signature only `if (config.whatsapp.appSecret)`. A deployment
   with an access token and a phone number but no app secret therefore accepted ANY POST to
   /webhooks/whatsapp, and three things followed from a forged body:

     • an invented inbound made the bot reply, so a WhatsApp message went from our own
       verified business number to a number the caller chose;
     • noteInbound() opened Meta's 24 h window for that number, after which free-form text
       needs no approved template;
     • invented `statuses` drove updateDelivery, marking a real one-time code delivered or
       failed on evidence nobody supplied.

   config snapshots the environment at module load, so this is its own process: the point is
   a deployment that BOOTED without the secret, which is the only way the gap exists.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/whatsapp-unsigned.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
delete process.env.WHATSAPP_APP_SECRET;      // the whole point

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** Anything we would have sent to Meta. It must stay empty. */
const sentToMeta: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes("graph.facebook.com") || url.includes("/messages")) {
    sentToMeta.push(url);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.forged" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { whatsappConfigured, config } = await import("../src/config.js");
  const { inReplyWindow } = await import("../src/core/whatsapp.js");

  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const VICTIM = "237699123456";
  const forgedInbound = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { messages: [{ from: VICTIM, id: "wamid.forged-in", type: "text", text: { body: "help" } }] } }] }],
  });
  const forgedStatus = JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: "some-real-message-id", status: "delivered", recipient_id: VICTIM }] } }] }],
  });

  try {
    console.log("\nWhatsApp is wired up, but its signature cannot be checked\n");
    ok("the deployment counts as configured — token and phone number are set", whatsappConfigured());
    ok("…and the app secret is genuinely absent", !config.whatsapp.appSecret);

    console.log("\nSo the webhook refuses, rather than trusting whatever arrives\n");
    let res = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json" }, body: forgedInbound });
    ok("an unsigned inbound is refused, not acked", res.status === 503, String(res.status));
    ok("…and the reason names the missing variable", /WHATSAPP_APP_SECRET/.test(JSON.stringify(await res.json().catch(() => ({})))));
    // A signature header does not help: there is nothing to check it against.
    res = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" }, body: forgedInbound });
    ok("a made-up signature does not get in either", res.status === 503, String(res.status));

    await new Promise((r) => setTimeout(r, 400));
    console.log("\nAnd none of the three consequences happen\n");
    ok("no WhatsApp message was sent from our business number", sentToMeta.length === 0, sentToMeta.join(" "));
    ok("the caller's chosen number is NOT inside Meta's 24 h window", !inReplyWindow(VICTIM));

    res = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json" }, body: forgedStatus });
    ok("a forged delivery receipt is refused too — the outbox keeps its own word", res.status === 503, String(res.status));

    console.log("\nThe verification handshake is unaffected — it has its own token\n");
    res = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=xyz`);
    ok("Meta can still verify the callback URL", res.status === 200 && (await res.text()) === "xyz", String(res.status));
    res = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=xyz`);
    ok("…and a wrong verify token is still refused", res.status === 403, String(res.status));
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

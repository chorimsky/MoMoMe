/* The receive loop, closed: someone who shared a "pay me" code can see what that number
   was paid — but ONLY after proving they hold it. Reading payments to an arbitrary number
   would leak every sender's activity, so an un-anchored device gets 403, and the list
   carries the recipient's view only (amount, state, when — never the payer).
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/received.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
delete process.env.SMS_WEBHOOK_URL;

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = (dev: string) => ({ "content-type": "application/json", "x-mm-sender": dev });
  const post = (p: string, b: unknown, dev: string) => fetch(`${base}${p}`, { method: "POST", headers: H(dev), body: JSON.stringify(b) });
  const get = (p: string, dev: string) => fetch(`${base}${p}`, { headers: H(dev) });
  const RECIPIENT = "677000789";

  try {
    console.log("\nReceived payments — the recipient's view\n");

    // Two payers pay the number.
    for (const [buyer, amt] of [["buyer-a", 5000], ["buyer-b", 7500]] as const) {
      const q = await (await post("/api/quotes", { xaf: amt, method: "LIGHTNING", country: "CM" }, buyer)).json();
      const p = await (await post("/api/payments", { quoteId: q.id, recipient: { phone: RECIPIENT, country: "CM", provider: "MTN", name: "Alice Ngo" } }, buyer)).json();
      await post(`/api/payments/${p.id}/simulate`, {}, buyer);
      let st = "";
      for (let i = 0; i < 60 && st !== "DELIVERED"; i++) { await new Promise((r) => setTimeout(r, 200)); st = (await (await get(`/api/payments/${p.id}`, buyer)).json()).state; }
      ok(`${buyer} pays ${amt} XAF and it settles`, st === "DELIVERED", st);
    }

    // A device that has proven nothing sees nothing.
    const stranger = await get("/api/me/received", "stranger-device");
    ok("an un-anchored device cannot read payments to any number", stranger.status === 403, String(stranger.status));

    // The recipient claims the number (OTP) — the claim links the device.
    const owner = "owner-device";
    const req = await (await post("/api/identities/claim/request", { phone: RECIPIENT }, owner)).json();
    ok("claim sends a code (sandbox devCode)", !!req.devCode, req.devCode);
    const ver = await post("/api/identities/claim/verify", { phone: RECIPIENT, code: req.devCode }, owner);
    ok("the code claims the number", ver.status === 200, String(ver.status));

    const mine = await get("/api/me/received", owner);
    const body = await mine.json();
    ok("…and the owner can now list what it received", mine.status === 200 && body.items?.length === 2, `${mine.status} items=${body.items?.length}`);
    ok("totals add up", body.totals?.count === 2 && body.totals?.xaf === 12500, JSON.stringify(body.totals));
    ok("newest first", body.items?.[0]?.xaf === 7500, String(body.items?.[0]?.xaf));
    const item = body.items?.[0] ?? {};
    ok("the recipient's view carries no payer identity", !("senderId" in item) && !("recipient" in item) && !("senderLocation" in item), Object.keys(item).join(","));
    ok("…but does carry what matters: amount, state, when, reference", item.ref && item.xaf && item.displayStatus === "Completed" && item.createdAt);

    // The same number from a SECOND device (a new phone, or the app after the web): the
    // OTP is the proof, so the claim must be repeatable — it used to answer 409.
    const second = "second-device";
    const req2 = await (await post("/api/identities/claim/request", { phone: RECIPIENT }, second)).json();
    ok("a claimed number can be claimed again from another device", !!req2.devCode, JSON.stringify(req2));
    const ver2 = await post("/api/identities/claim/verify", { phone: RECIPIENT, code: req2.devCode }, second);
    const mine2 = await (await get("/api/me/received", second)).json();
    ok("…and that device sees the same received payments", ver2.status === 200 && mine2.items?.length === 2, `${ver2.status} items=${mine2.items?.length}`);

    // Own-your-number (anchor) is the other proof and works the same.
    const other = "other-device";
    const a = await (await post("/api/me/anchor/request", { phone: "699000155" }, other)).json();
    await post("/api/me/anchor/verify", { phone: "699000155", code: a.devCode }, other);
    const none = await (await get("/api/me/received", other)).json();
    ok("an anchored number with no payments lists none, not someone else's", none.items?.length === 0 && none.phone === "699000155", JSON.stringify(none));
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

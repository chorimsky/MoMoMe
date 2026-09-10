/* ============================================================
   Store review access (core/review.ts).

   Google Play rejected version code 4 for a "login wall": the "own your number" step asks
   for a Mobile Money number and sends an SMS code, which a reviewer cannot receive. With
   REVIEW_PHONE / REVIEW_OTP set, that one number gets a fixed code and never gets paid.
   This test runs with REVIEW_PHONE=670000000 REVIEW_OTP=246810 (see package.json).
   ============================================================ */
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
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "device-reviewer" };
  const post = (p: string, b?: unknown) => fetch(`${base}${p}`, { method: "POST", headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
  const REVIEW = "670000000", CODE = "246810";

  try {
    console.log("\nStore review access");
    // Own your number (claim): the review number has never been paid, yet it can be claimed.
    let r = await post("/api/identities/claim/request", { phone: REVIEW });
    ok("claim request for the review number answers sent", r.status === 200 && (await r.json() as { sent: boolean }).sent === true, String(r.status));
    r = await post("/api/identities/claim/verify", { phone: REVIEW, code: "000000" });
    ok("a wrong code is still refused", r.status === 400, String(r.status));
    r = await post("/api/identities/claim/verify", { phone: REVIEW, code: CODE });
    ok("the fixed code claims it", r.status === 200 && (await r.json() as { claimed: boolean }).claimed === true, String(r.status));
    r = await post("/api/identities/claim/request", { phone: REVIEW });
    ok("…and it can be claimed again by the next reviewer", r.status === 200, String(r.status));

    // Anchor (backup) flow: same number, same code, no SMS needed.
    await post("/api/me/devices", { platform: "test" });
    r = await post("/api/me/anchor/request", { phone: REVIEW });
    ok("anchor request for the review number answers sent", r.status === 200, String(r.status) + " " + (await r.text()).slice(0, 80));

    // A real number is NOT affected: no identity → 404, as before.
    r = await post("/api/identities/claim/request", { phone: "699000118" });
    ok("an ordinary unpaid number still has nothing to claim", r.status === 404, String(r.status));

    // Money can never move to the review number.
    let q = await post("/api/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const quote = await q.json() as { id: string };
    r = await post("/api/payments", { quoteId: quote.id, recipient: { phone: REVIEW, country: "CM", provider: "MTN", name: "Store review" } });
    const body = await r.json() as { error?: string };
    ok("a payment to the review number is refused", r.status === 400 && body.error === "reserved_number", `${r.status} ${body.error}`);
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();

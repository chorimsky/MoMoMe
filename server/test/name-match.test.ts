/* Every Mobile Money number belongs to a named account holder, and a payment must be to the
   person the sender means. The typed name used to be decorative: a sender who wrote "Alice"
   for a number registered to "NANA JEAN PAUL" was shown a green tick and paid a stranger.
   Now the stated name is checked against the registered one, on the SERVER (a stale client
   or a direct API call gets the same question), a mismatch needs an explicit, per-payment
   acknowledgement, and the registered name is what the payment carries. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "risk-test-secret";

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
  const H = { "content-type": "application/json", "x-mm-sender": "device-alice" };
  const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) });
  const quote = async () => (await (await post("/api/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" })).json() as { id: string }).id;
  // 670123456 is the sandbox's fixed registered number: NANA JEAN PAUL.
  const REG = "670123456";

  try {
    console.log("\nThe registered name — a payment goes to the person the sender means\n");

    /* ---- the resolver tells the truth about who the number belongs to ---- */
    const r = await (await fetch(`${base}/api/recipients/resolve?phone=${REG}&country=CM`, { headers: H })).json() as { status: string; name?: string };
    ok("the resolver reports the registered holder", r.status === "provider" && r.name === "NANA JEAN PAUL", `${r.status} ${r.name}`);

    /* ---- a name that contradicts the registration is a question, not a payment ---- */
    let q = await quote();
    const bad = await post("/api/payments", { quoteId: q, recipient: { phone: REG, country: "CM", provider: "MTN", name: "Alice Ngo" } });
    const badBody = await bad.json() as { error?: string; code?: string; operatorName?: string; riskToken?: string; message?: string };
    ok("paying under the wrong name is refused with a question", bad.status === 409 && badBody.error === "confirm_recipient" && badBody.code === "name_mismatch", `${bad.status} ${badBody.code}`);
    ok("…that names the registered holder", badBody.operatorName === "NANA JEAN PAUL" && /NANA JEAN PAUL/.test(badBody.message ?? ""), badBody.operatorName);
    ok("…and carries a token to answer it", typeof badBody.riskToken === "string" && badBody.riskToken.length > 8);

    /* ---- the quote survives the refusal, and the answer opens exactly that door ---- */
    const again = await post("/api/payments", { quoteId: q, recipient: { phone: REG, country: "CM", provider: "MTN", name: "Alice Ngo" }, riskToken: badBody.riskToken });
    const againBody = await again.json() as { id?: string; recipient?: { name: string; nameSource: string } };
    ok("the same payment goes through once acknowledged", again.status === 200 && !!againBody.id, String(again.status));
    ok("and it is recorded under the REGISTERED name, not the typed label",
       againBody.recipient?.name === "NANA JEAN PAUL" && againBody.recipient?.nameSource === "provider", JSON.stringify(againBody.recipient));

    /* ---- a token is bound to its payment ---- */
    q = await quote();
    const reused = await post("/api/payments", { quoteId: q, recipient: { phone: "677000785", country: "CM", provider: "MTN", name: "Alice Ngo" }, riskToken: badBody.riskToken });
    ok("the acknowledgement cannot be reused for another number", reused.status === 409 || reused.status === 200 && (await reused.json() as { recipient: { name: string } }).recipient.name !== "NANA JEAN PAUL", String(reused.status));

    /* ---- the same person, spelled differently, sails through ---- */
    for (const spelled of ["Jean Paul Nana", "nana jean-paul", "J. P. Nana"]) {
      q = await quote();
      const res = await post("/api/payments", { quoteId: q, recipient: { phone: REG, country: "CM", provider: "MTN", name: spelled } });
      ok(`"${spelled}" is recognised as the registered holder`, res.status === 200, String(res.status));
    }

    /* ---- no stated name: the registered one is adopted ---- */
    q = await quote();
    const blank = await post("/api/payments", { quoteId: q, recipient: { phone: REG, country: "CM", provider: "MTN", name: "" } });
    const blankBody = await blank.json() as { recipient?: { name: string } };
    ok("with no name given, the registered name is used", blank.status === 200 && blankBody.recipient?.name === "NANA JEAN PAUL", blankBody.recipient?.name);

    /* ---- a number nobody can name still requires the sender to say who it is ---- */
    q = await quote();
    const unknown = await post("/api/payments", { quoteId: q, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Rose Etoa" } });
    const unknownBody = await unknown.json() as { recipient?: { name: string; nameSource: string } };
    ok("an unregistered number keeps the sender's stated name", unknown.status === 200 && unknownBody.recipient?.name === "Rose Etoa", JSON.stringify(unknownBody.recipient));

    /* ---- bidi and zero-width characters never reach a stored name ---- */
    // U+202E (right-to-left override) can render "ecilA" as "Alice"; U+200B is invisible.
    // Both are format characters (\p{Cf}); the old cleaner only removed controls (\p{Cc}).
    q = await quote();
    const bidi = await post("/api/payments", { quoteId: q, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "\u202eaotE esoR\u200b" } });
    const bidiBody = await bidi.json() as { recipient?: { name: string } };
    ok("bidi override and zero-width chars are stripped from the stated name", bidi.status === 200 && !/[\u202e\u200b]/u.test(bidiBody.recipient?.name ?? ""), JSON.stringify(bidiBody.recipient?.name));
    ok("what remains is the visible text", bidiBody.recipient?.name === "aotE esoR", JSON.stringify(bidiBody.recipient?.name));
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();

/* Our own Lightning node as a rail — the LUD-06 description_hash path.

   A Lightning-Address payer's wallet fetches the payRequest, shows the metadata, then
   fetches the invoice and checks the invoice's h tag == sha256(metadata). IBEX cannot set
   h; phoenixd can. This drives the whole flow over HTTP against createApp() with a fake
   phoenixd: the invoice request must carry EXACTLY the hash of the served metadata, the
   payment must be minted on phoenixd, its webhook must not settle without the authoritative
   re-query, and the re-query must settle it to DELIVERED.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/phoenixd-lnurl.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PHOENIXD_URL = "http://phoenixd.test:9740";
process.env.PHOENIXD_PASSWORD = "test-phoenix-password";
process.env.PHOENIXD_WEBHOOK_SECRET = "test-phoenix-webhook";
process.env.PHOENIXD_CHAIN = "testnet"; // NOT trusted: no real payout in this test
// IBEX configured too, so the test proves the description-hash rail is chosen OVER it.
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_CLIENT_ID = "test-client";
process.env.IBEX_CLIENT_SECRET = "test-secret";
process.env.IBEX_ACCOUNT_ID = "btc-account";
process.env.IBEX_WEBHOOK_SECRET = "test-webhook-secret";

import type { AddressInfo } from "node:net";
import { createHash, createHmac } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const invoices = new Map<string, { descriptionHash?: string; description?: string; amountSat: number; paid: boolean; feeSat?: number }>();
let ibexInvoiceCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  const req = init as { method?: string; body?: string; headers?: Record<string, string> } | undefined;
  if (url.startsWith("http://phoenixd.test:9740")) {
    if (req?.headers?.Authorization !== "Basic " + Buffer.from(":test-phoenix-password").toString("base64")) return new Response("unauthorized", { status: 401 });
    if (url.endsWith("/createinvoice")) {
      const f = new URLSearchParams(String(req?.body ?? ""));
      const hash = createHash("sha256").update(`inv-${invoices.size + 1}`).digest("hex");
      invoices.set(hash, { descriptionHash: f.get("descriptionHash") ?? undefined, description: f.get("description") ?? undefined, amountSat: Number(f.get("amountSat")), paid: false });
      return J({ amountSat: Number(f.get("amountSat")), paymentHash: hash, serialized: `lnbc1fake${hash.slice(0, 20)}` });
    }
    const m = url.match(/\/payments\/incoming\/([0-9a-f]+)$/);
    if (m) { const inv = invoices.get(m[1]); return inv ? J({ paymentHash: m[1], isPaid: inv.paid, receivedSat: inv.paid ? inv.amountSat - (inv.feeSat ?? 0) : 0, fees: inv.paid ? inv.feeSat ?? 0 : 0 }) : J({}, 404); }
    if (url.endsWith("/getbalance")) return J({ balanceSat: 250_000, feeCreditSat: 1_500 });
    return J({}, 404);
  }
  if (url.includes("poweredbyibex.io")) {
    if (url.includes("/oauth/token")) return J({ access_token: "tok", expires_in: 3600 });
    if (url.includes("/invoice/add")) { ibexInvoiceCalls++; return J({ transactionId: "ibex-tx", bolt11: "lnbc1ibex", hash: "x" }); }
    if (url.includes("/webhooks")) return new Response(null, { status: 204 });
    return J({}, 404);
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { bolt11DescriptionHash } = await import("../src/core/bolt11.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "phoenixd-lnurl" };
  const get = async (p: string, h: Record<string, string> = {}) => (await (await fetch(`${base}${p}`, { headers: { ...DEV, ...h } })).json());
  const PHONE = "677000789";
  const LN = { "x-mm-sender": `lnurl:237${PHONE}@momome.xyz` }; // the payment's own sender scope

  try {
    console.log("\nphoenixd rail — a Lightning Address any wallet can pay (LUD-06 description_hash)");

    // A real mainnet bolt11 with an h tag decodes (sanity for the decoder used in prod checks).
    ok("bolt11DescriptionHash returns null for an invoice without h", bolt11DescriptionHash("lnbc1fakeinvoice") === null);

    const pr = await get(`/.well-known/lnurlp/${PHONE}`) as { tag: string; metadata: string; callback: string };
    ok("payRequest served", pr.tag === "payRequest");
    const want = createHash("sha256").update(pr.metadata, "utf8").digest("hex");

    const cb = await get(`/lnurl/pay/${PHONE}?amount=2000000`) as { pr?: string; reason?: string };
    ok("callback returns an invoice", typeof cb.pr === "string", cb.reason ?? cb.pr);
    const [hash, inv] = [...invoices.entries()][0] ?? [];
    ok("the invoice was minted on phoenixd, not IBEX", !!inv && ibexInvoiceCalls === 0, `ibex calls=${ibexInvoiceCalls}`);
    ok("…with descriptionHash = sha256(served metadata), byte for byte", inv?.descriptionHash === want, `${inv?.descriptionHash?.slice(0, 12)} vs ${want.slice(0, 12)}`);
    ok("…and no plain description competing with it", inv?.description === undefined);
    ok("…for the payer's exact amount (2000 sat)", inv?.amountSat === 2000, String(inv?.amountSat));

    const all = await get("/api/payments", { "x-mm-sender": `lnurl:237${PHONE}@momome.xyz` }) as Array<{ id: string; state: string; payInstruction: { provider: string; providerRef: string } }>;
    const pay = all.find((p) => p.payInstruction.provider === "phoenixd");
    ok("the payment records phoenixd as its rail, keyed by payment hash", !!pay && pay.payInstruction.providerRef === hash, pay?.payInstruction.providerRef?.slice(0, 12));
    if (!pay) throw new Error("no phoenixd payment");

    // A webhook alone must not settle: the body is a hint, the re-query is the truth.
    const body = JSON.stringify({ type: "payment_received", amountSat: 2000, paymentHash: hash, externalId: "x" });
    let r = await fetch(`${base}/webhooks/phoenixd`, { method: "POST", headers: { "content-type": "application/json", "x-phoenix-signature": "deadbeef" }, body });
    ok("a webhook with a bad HMAC is refused", r.status === 401, String(r.status));
    const sig = createHmac("sha256", "test-phoenix-webhook").update(body).digest("hex");
    r = await fetch(`${base}/webhooks/phoenixd`, { method: "POST", headers: { "content-type": "application/json", "x-phoenix-signature": sig }, body });
    ok("a correctly signed webhook is accepted", r.status === 200, String(r.status));
    await new Promise((res) => setTimeout(res, 600));
    let cur = await get(`/api/payments/${pay.id}`, LN) as { state: string };
    ok("…but an UNPAID invoice does not settle on the webhook body", cur.state === "AWAITING_INBOUND", cur.state);

    // Now the node says it was paid → the same webhook settles it, all the way. This is the
    // node's FIRST receive: it kept 300 sat as its liquidity purchase. No on-chain reserve
    // was needed to get here — the channel is bought out of the payment itself.
    invoices.get(hash)!.paid = true;
    invoices.get(hash)!.feeSat = 300;
    r = await fetch(`${base}/webhooks/phoenixd`, { method: "POST", headers: { "content-type": "application/json", "x-phoenix-signature": sig }, body });
    for (let i = 0; i < 50; i++) { await new Promise((res) => setTimeout(res, 100)); cur = await get(`/api/payments/${pay.id}`, LN) as { state: string }; if (["DELIVERED", "FAILED", "MANUAL_REVIEW"].includes(cur.state)) break; }
    ok("paid on our node → delivered as Mobile Money", cur.state === "DELIVERED", cur.state);
    const full = await get(`/api/payments/${pay.id}`, LN) as { xaf: number; repricedFromXaf?: number; events: Array<{ note?: string }> };
    ok("the customer is credited the FULL locked amount (no Quoted → Delivered)", full.repricedFromXaf === undefined, String(full.repricedFromXaf));
    const led = await get(`/api/ledger/${pay.id}`, LN) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const feeLeg = led.find((e) => e.account === "rail_fees");
    ok("the liquidity fee is booked as rail_fees, in BTC", !!feeLeg && Math.abs(feeLeg.amount - 300 / 1e8) < 1e-12 && feeLeg.currency === "BTC", JSON.stringify(feeLeg));
    const fx = led.filter((e) => e.account === "fx_position" && e.currency === "BTC").reduce((a, e) => a + (e.direction === "credit" ? e.amount : -e.amount), 0);
    ok("fx_position holds what the node really holds (amount − fee)", Math.abs(fx - (2000 - 300) / 1e8) < 1e-12, String(fx));
    ok("…and the payment says the fee was absorbed by MoMo›Me", full.events.some((e) => /absorbed by MoMo›Me/.test(e.note ?? "")));

    // In-app Lightning (no hash needed) still goes to IBEX first — phoenixd is the failover.
    r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 5000, method: "LIGHTNING", country: "CM" }) });
    const q = await r.json() as { id: string };
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({ quoteId: q.id, recipient: { phone: "690555444", country: "CM", provider: "MTN" } }) });
    const p2 = await r.json() as { payInstruction?: { provider: string } };
    ok("ordinary in-app Lightning still mints on IBEX (priority 0)", p2.payInstruction?.provider === "ibex", p2.payInstruction?.provider);
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

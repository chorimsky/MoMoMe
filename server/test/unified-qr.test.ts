/* One QR, two ways to pay it — BIP-21 with a Lightning invoice folded in.

   `bitcoin:<addr>?amount=…&lightning=<bolt11>`: a Lightning-capable wallet pays the
   invoice, one that isn't ignores the unknown parameter and pays the address. That
   graceful degradation is why both fit in a single code — and why the ERC-20 stablecoins
   cannot join them, since `bitcoin:` and `ethereum:` are disjoint namespaces no wallet
   reads both of.

   The hard part is not the QR, it is that the two legs settle under DIFFERENT rules —
   Lightning is full-or-nothing and keeps its rate lock; on-chain can be partial and is
   re-priced on confirmation. So settlement has to key on the leg that was actually paid,
   not on the payment's method. And a payer who uses BOTH must not be paid out twice.

   IBEX's HTTP surface is mocked; every layer of ours is real. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_CLIENT_ID = "test-client";
process.env.IBEX_CLIENT_SECRET = "test-secret";
process.env.IBEX_ACCOUNT_ID = "btc-account";
process.env.IBEX_WEBHOOK_SECRET = "test-webhook-secret";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const ADDR = "bc1qunifiedqrtestaddress00000000000000000";
const BOLT11 = "lnbc1unifiedqrtestinvoicepayload000000";
const LN_TX = "ibex-ln-tx-1";
let lnSettled = false;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("poweredbyibex.io")) {
    if (url.includes("/oauth/token")) return J({ access_token: "tok", expires_in: 3600 });
    if (url.includes("/invoice/add")) return J({ transactionId: LN_TX, bolt11: BOLT11, hash: "h" });
    if (url.includes("/onchain/address")) return J({ address: ADDR });
    if (url.includes("/transaction/")) {
      return J({ id: LN_TX, settledAt: lnSettled ? new Date().toISOString() : null,
        invoice: { state: { name: lnSettled ? "SETTLED" : "OPEN" }, settleDateUtc: lnSettled ? new Date().toISOString() : null, receiveMsat: lnSettled ? 1 : 0 } });
    }
    return J({}, 404);
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

const IBEX_IP = { "content-type": "application/json", "x-forwarded-for": "35.243.242.121" };
const lnWebhook = () => JSON.stringify({
  secret: "test-webhook-secret",
  transaction: { id: LN_TX, transactionTypeId: 1, settledAt: new Date().toISOString(),
    invoice: { state: { name: "SETTLED" }, settleDateUtc: new Date().toISOString(), receiveMsat: 1 } },
});
const onchainWebhook = (txId: string, btc: number) => JSON.stringify({
  secret: "test-webhook-secret",
  transaction: { id: txId, transactionTypeId: 7, address: ADDR, amount: Math.round(btc * 1e11), status: "settled", settledAt: new Date().toISOString() },
});

async function main() {
  const { createApp } = await import("../src/app.js");
  const { ensureRatesFresh } = await import("../src/core/rates.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "unified-qr" };
  const get = async (p: string) => (await (await fetch(`${base}${p}`, { headers: DEV })).json());
  const settleTo = async (id: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const c = await get(`/api/payments/${id}`) as { state: string; events: Array<{ note?: string }> };
      if (["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW"].includes(c.state)) return c;
    }
    return await get(`/api/payments/${id}`) as { state: string; events: Array<{ note?: string }> };
  };
  const newOnchainPayment = async (phone: string) => {
    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 25000, method: "ONCHAIN", country: "CM" }) });
    const q = await r.json() as { id: string };
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
      quoteId: q.id, recipient: { phone, country: "CM", provider: "MTN", name: "Unified QR" } }) });
    return await r.json() as { id: string; ref: string; payInstruction: { code: string; qr: string; amount: number; providerRef: string; alt?: { method: string; code: string; providerRef: string; expiresAt: string; amount: number } } };
  };

  try {
    console.log("\nUnified BIP-21 QR — one code, on-chain or Lightning");
    await ensureRatesFresh().catch(() => {});

    const pay = await newOnchainPayment("677000789");
    const pi = pay.payInstruction;
    ok("the on-chain address is the primary leg", pi.code === ADDR, pi.code);
    ok("a Lightning leg was minted for the SAME payment", pi.alt?.method === "LIGHTNING", String(pi.alt?.method));
    ok("both legs ask for the same BTC amount", pi.alt?.amount === pi.amount, `${pi.alt?.amount} vs ${pi.amount}`);
    ok("the QR is ONE BIP-21 code carrying both", pi.qr.startsWith(`bitcoin:${ADDR}?amount=`) && pi.qr.includes("&lightning="), pi.qr.slice(0, 64));
    ok("the invoice rides uppercased (QR alphanumeric mode)", pi.qr.includes(BOLT11.toUpperCase()));
    ok("a wallet that ignores `lightning=` still reads the address", pi.qr.split("?")[0] === `bitcoin:${ADDR}`);

    // The whole point: a webhook on EITHER leg must find this payment.
    // 1) Pay the LIGHTNING leg of an ON-CHAIN payment.
    lnSettled = true;
    let r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: lnWebhook() });
    ok("a Lightning webhook is accepted", r.status === 200, String(r.status));
    const cur = await settleTo(pay.id);
    const notes = cur.events.map((e) => e.note).filter(Boolean).join(" | ");
    ok("paying the Lightning leg settles the on-chain payment", cur.state === "DELIVERED", `${cur.state} ${notes}`);
    // Keying off payInstruction.method would have run the ON-CHAIN rules here: a re-price
    // needing a fresh feed, and an amount check against a webhook that carries none.
    ok("it settled under LIGHTNING rules — no on-chain re-price", !notes.includes("re-priced") && !notes.includes("FX feed not fresh"), notes || "(no notes)");

    const led = await get(`/api/ledger/${pay.id}`) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const net: Record<string, number> = {};
    for (const e of led) net[e.currency] = Math.round(((net[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)) * 1e9) / 1e9;
    ok("the books balance", Object.values(net).every((v) => v === 0), JSON.stringify(net));
    ok("the recipient was paid exactly once", led.filter((e) => e.account === "external_recipient").length === 1);

    // 2) DOUBLE PAY: the same payer now also sends the on-chain leg. It must not deliver
    //    twice, and must not be silently kept.
    const legsBefore = led.length;
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: onchainWebhook("ibex-onchain-tx-9", pi.amount) });
    await new Promise((res) => setTimeout(res, 900));
    const led2 = await get(`/api/ledger/${pay.id}`) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const after = await get(`/api/payments/${pay.id}`) as { state: string; events: Array<{ note?: string }> };
    const owed = led2.filter((e) => e.account === "refund_payable").reduce((s, e) => s + (e.direction === "debit" ? e.amount : -e.amount), 0);
    ok("paying BOTH legs does not pay the recipient twice",
      led2.filter((e) => e.account === "external_recipient").length === 1,
      `${led2.filter((e) => e.account === "external_recipient").length} delivery legs`);
    ok("the second leg is booked as a refund owed", led2.length > legsBefore && owed < 0, `owed ${owed}`);
    ok("and it is explained on the payment", after.events.some((e) => (e.note ?? "").includes("refund owed")));

    // 3) The other direction: an on-chain payment paid ON-CHAIN still re-prices as before.
    const pay2 = await newOnchainPayment("677000790");
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: onchainWebhook("ibex-onchain-tx-10", pay2.payInstruction.amount) });
    const cur2 = await settleTo(pay2.id);
    ok("an on-chain payment paid on-chain still settles", cur2.state === "DELIVERED", cur2.state);
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

/* USDC end-to-end, through the real IBEX code path.

   USDC was fully built but switched off in two places (the server's `methods` default and
   the web send flow's picker), so nothing exercised it. This drives the whole chain over
   HTTP against createApp(): config → quote → payment (IBEX mints an ERC-20 receive address
   on the USDC account) → deposit webhook → settlement → payout → DELIVERED → balanced
   double-entry ledger. Only IBEX's own HTTP surface is mocked; every layer of ours is real.

   IBEX is account-per-currency, so the assertion that the address is minted on the USDC
   account (currencyId 30) and not the USDT one is not a detail — crediting the wrong
   account is a lost deposit.

   Runs with IBEX_ENV=sandbox and IBEX_ALLOW_SANDBOX_PAYOUT unset, so trusted() is false:
   the payout takes the simulated rail and the flow reaches DELIVERED with no live
   credential and no real money in motion. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_CLIENT_ID = "test-client";
process.env.IBEX_CLIENT_SECRET = "test-secret";
process.env.IBEX_ACCOUNT_ID = "btc-account";
process.env.IBEX_USDT_ACCOUNT_ID = "usdt-account";
process.env.IBEX_USDC_ACCOUNT_ID = "usdc-account";
process.env.IBEX_WEBHOOK_SECRET = "test-webhook-secret";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

// A distinct receive address per mint, exactly as IBEX issues them.
let minted = 0;
const addrFor = (n: number) => `0x${n.toString(16).padStart(40, "a")}`;
const calls: string[] = [];

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (addr: string) => "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
/** Deposits IBEX "has seen": pushed by the test before a webhook (or a tick) is fired. */
const deposits: Array<{ id: string; usdc: number; txHash: string; to: string }> = [];
let txn = 0;
const seeDeposit = (to: string, usdc: number) => { const id = `ibex-usdc-tx-${++txn}`; deposits.push({ id, usdc, txHash: "0x" + txn.toString(16).padStart(64, "b"), to: to.toLowerCase() }); return id; };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("poweredbyibex.io")) {
    calls.push(url.replace(/^https?:\/\/[^/]+/, ""));
    if (url.includes("/oauth/token")) return J({ access_token: "tok-123", expires_in: 3600 });
    if (url.includes("/crypto/receive-infos")) {
      return J({ id: `recv-${++minted}`, type: "ethereum", data: { address: addrFor(minted) } });
    }
    // The deposit list + details, exactly as IBEX serves them: the list carries the
    // account and the amount in whole tokens, never the address; /details adds the tx hash.
    if (url.includes("/transactions?")) return J({ transactions: deposits.map((d) => ({ id: d.id, currencyId: 30, transactionTypeId: 9, status: "completed", amount: d.usdc, settledAt: new Date().toISOString(), accountId: "usdc-account" })) });
    const det = url.match(/\/v2\/transaction\/([^/]+)\/details/);
    if (det) { const d = deposits.find((x) => x.id === det[1]); return d ? J({ networkId: d.txHash, link: "" }) : J({}, 404); }
    return J({}, 404);
  }
  // The Ethereum RPC: the receipt of a batched exchange withdrawal — many USDC transfers to
  // strangers, ours among them.
  if (url.includes("ethereum-rpc.publicnode.com")) {
    const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as { params?: string[] };
    const d = deposits.find((x) => x.txHash === body.params?.[0]);
    if (!d) return J({ jsonrpc: "2.0", id: 1, result: null });
    const usdcLog = (to: string, usdc: number) => ({ address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", topics: [TRANSFER, pad("0x7830c87c02e56aff27fa8ab1241711331fa86f43"), pad(to)], data: "0x" + BigInt(Math.round(usdc * 1e6)).toString(16).padStart(64, "0") });
    return J({ jsonrpc: "2.0", id: 1, result: { status: "0x1", logs: [usdcLog("0x" + "1".repeat(40), 370), usdcLog("0x" + "2".repeat(40), 37310.799673), usdcLog(d.to, d.usdc), usdcLog("0x" + "3".repeat(40), 4999.848016)] } });
  }
  // FX venues — fixed prices so the assertions are about our code, not live markets.
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

/** A USDC deposit webhook exactly as IBEX sends it (verified live 2026-09-10): currencyId
 *  30, amount in WHOLE tokens, and NO receive address — only the account. The deposit is
 *  also visible on the rail's transaction list, which is where settlement reads it from. */
const depositBody = (address: string, usdc: number) => JSON.stringify({
  secret: "test-webhook-secret",
  transaction: {
    id: seeDeposit(address, usdc), currencyId: 30, transactionTypeId: 9, accountId: "usdc-account",
    amount: usdc, status: "completed", settledAt: new Date().toISOString(),
  },
});

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "usdc-e2e-device" };
  const IBEX_IP = { "content-type": "application/json", "x-forwarded-for": "35.243.242.121" }; // documented sandbox sender
  const get = async (p: string) => (await (await fetch(`${base}${p}`, { headers: DEV })).json());
  const settle = async (id: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const cur = await get(`/api/payments/${id}`) as { state: string; events: Array<{ note?: string }> };
      if (["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW"].includes(cur.state)) return cur;
    }
    return await get(`/api/payments/${id}`) as { state: string; events: Array<{ note?: string }> };
  };

  try {
    console.log("\nUSDC end-to-end — config → quote → ERC-20 address → deposit → payout → ledger");

    // 1. The method has to actually be OFFERED. This is the flag the send flow filters on;
    //    with it false the client never shows USDC and /payments refuses the method.
    const cfg = await get("/api/config") as { methods?: Record<string, boolean> };
    ok("USDC is offered by GET /config", cfg.methods?.USDC === true, JSON.stringify(cfg.methods));

    // 2. Quote. Unlike on-chain BTC, a stablecoin quote LOCKS the rate (no 10-60 min
    //    confirmation window), so it must not come back estimateOnly.
    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 30000, method: "USDC", country: "CM" }) });
    const q = await r.json() as { id: string; xaf: number; feeXaf: number; totalXaf: number; estimateOnly?: boolean };
    ok("USDC quote issued", r.status === 200 && !!q.id, String(r.status));
    ok("rate is LOCKED, not an estimate", q.estimateOnly !== true);
    ok("fee math holds", q.xaf + q.feeXaf === q.totalXaf, `${q.xaf}+${q.feeXaf}=${q.totalXaf}`);

    // 3. Payment — IBEX mints the receive address, on the USDC account.
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
      quoteId: q.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "USDC E2E" } }) });
    const pay = await r.json() as { id: string; ref: string; payInstruction: { method: string; code: string; qr: string; asset: string; amount: number; provider: string; providerRef: string } };
    const pi = pay.payInstruction;
    ok("payment created", r.status === 200, String(r.status));
    ok("instruction minted by IBEX (not the simulated rail)", pi?.provider === "ibex", pi?.provider);
    ok("customer is given an ERC-20 address", /^0x[0-9a-f]{40}$/.test(pi?.code ?? ""), pi?.code);
    ok("asset is USDC", pi?.asset === "USDC", pi?.asset);
    // The QR is the BARE address. It used to be an EIP-681 URI (chain + token + amount),
    // which MetaMask honours but the exchange apps most payers withdraw from (Binance, OKX,
    // Bybit…) refuse outright — they scan for a plain 0x address. Chain and amount are
    // printed beside the code, and the web Pay step offers the EIP-681 URI as an
    // "Open in wallet" link for wallets that understand it. `code` stays the match key.
    ok("QR is the bare 0x address every scanner reads",
      /^0x[0-9a-fA-F]{40}$/.test(pi?.qr ?? "") && pi?.qr === pi?.code, pi?.qr?.slice(0, 44));
    ok("providerRef is the address — the webhook match key", pi?.providerRef === pi?.code);
    ok("minted on the USDC account, not the USDT one",
      calls.some((c) => c.includes("/accounts/usdc-account/crypto/receive-infos")) &&
      !calls.some((c) => c.includes("usdt-account")), calls.filter((c) => c.includes("accounts")).join(" "));

    // 4. Webhook rejection paths — these are what stand between a forged callback and a
    //    real Mobile-Money payout.
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: JSON.stringify({ secret: "wrong", transaction: { id: "x", currencyId: 30, address: pi.code, amount: 1 } }) });
    ok("wrong shared secret → 401", r.status === 401, String(r.status));
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" }, body: depositBody(pi.code, pi.amount) });
    ok("sender IP not on IBEX's allowlist → 401", r.status === 401, String(r.status));
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "35.243.242.121, 203.0.113.9" }, body: depositBody(pi.code, pi.amount) });
    ok("allowlisted IP PREPENDED to the XFF chain → 401 (not spoofable)", r.status === 401, String(r.status));

    // 5. The deposit lands.
    const before = calls.length;
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: depositBody(pi.code, pi.amount) });
    ok("valid deposit webhook accepted", r.status === 200, String(r.status));
    const cur = await settle(pay.id);
    const note = cur.events.map((e) => e.note).filter(Boolean).join(" | ");
    ok("settles all the way to DELIVERED", cur.state === "DELIVERED", `${cur.state} ${note}`);

    // A deposit's providerRef is an ADDRESS, not a transaction id. Re-querying
    // /v2/transaction/{address} cannot answer, and a rail that replies {settled:false}
    // rather than 404 would silently drop the settlement — so we must not ask at all.
    // (The deposit's OWN id is asked for its /details — that is where the tx hash lives.)
    ok("no /v2/transaction re-query by address (address is not a txn id)",
      !calls.slice(before).some((c) => c.includes(`/transaction/${pi.code}`)), calls.slice(before).join(" "));
    ok("the deposit was matched to THIS address through the chain receipt",
      calls.slice(before).some((c) => c.includes("/details")), calls.slice(before).join(" "));

    // 6. The money invariant.
    const led = await get(`/api/ledger/${pay.id}`) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const net: Record<string, number> = {};
    for (const e of led) net[e.currency] = Math.round(((net[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)) * 1e9) / 1e9;
    ok("ledger balances in every currency", Object.values(net).every((v) => v === 0), JSON.stringify(net));
    ok("the USDC leg is booked as USDC", Object.keys(net).includes("USDC"), Object.keys(net).join(","));
    ok("exactly one delivery leg", led.filter((e) => e.account === "external_recipient").length === 1);
    ok("inbound booked exactly once", led.filter((e) => e.account === "inbound_clearing").length === 1);
    ok("fee revenue booked", led.filter((e) => e.account === "fee_revenue").length === 1);

    // 7. Providers retry. A replayed deposit must not pay out twice.
    const legs = led.length;
    const replay = JSON.stringify({ secret: "test-webhook-secret", transaction: { id: deposits[0].id, currencyId: 30, transactionTypeId: 9, accountId: "usdc-account", amount: pi.amount, status: "completed", settledAt: new Date().toISOString() } });
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: replay });
    await new Promise((res) => setTimeout(res, 800));
    const led2 = await get(`/api/ledger/${pay.id}`) as unknown[];
    ok("duplicate deposit webhook does not re-post the ledger", led2.length === legs, `${legs} → ${led2.length}`);

    // 8. Underpayment guard — a deposit smaller than the locked amount must never pay the
    //    full fiat out. (The chain receipt is the amount of record, in whole tokens.)
    r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 30000, method: "USDC", country: "CM" }) });
    const q2 = await r.json() as { id: string };
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
      quoteId: q2.id, recipient: { phone: "677000598", country: "CM", provider: "MTN", name: "USDC Underpay" } }) });
    const pay2 = await r.json() as { id: string; payInstruction: { code: string; amount: number } };
    ok("second payment gets a DIFFERENT address", pay2.payInstruction.code !== pi.code, pay2.payInstruction.code);
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: depositBody(pay2.payInstruction.code, pay2.payInstruction.amount / 2) });
    const cur2 = await settle(pay2.id);
    ok("half-amount deposit does NOT deliver the full payout", cur2.state !== "DELIVERED", cur2.state);
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

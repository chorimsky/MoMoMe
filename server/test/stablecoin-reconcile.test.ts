/* Stablecoin settlement from the rail's deposit list — the path that replaced "wait for a
   webhook that cannot match". Modelled on the real 2026-09-10 case: a Coinbase batch
   withdrawal (one tx, many transfers) carrying our 1.81 USDC.

   Covers: the receipt names OUR address among strangers → the right payment settles with
   the chain's amount; a second pass is idempotent; an unreadable receipt is retried, not
   written off; a deposit paying no open payment is held as unattributed IN THE RIGHT UNITS
   and booked; with no tx hash, the amount settles only when it names exactly one payment.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/stablecoin-reconcile.test.ts */
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
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const log = (to: string, usdc: number) => ({ address: USDC, topics: [TRANSFER, pad("0x7830c87c02e56aff27fa8ab1241711331fa86f43"), pad(to)], data: "0x" + BigInt(Math.round(usdc * 1e6)).toString(16).padStart(64, "0") });

let minted = 0;
const addrFor = (n: number) => `0x${n.toString(16).padStart(40, "c")}`;
const deposits: Array<{ id: string; amount: number; hash: string | null; btc?: boolean }> = [];
/** txid → outputs, as mempool.space answers /api/tx/{txid}. */
const btcTxs = new Map<string, Array<{ scriptpubkey_address: string; value: number }>>();
const receipts = new Map<string, unknown>();
let rpcDown = false;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("poweredbyibex.io")) {
    if (url.includes("/oauth/token")) return J({ access_token: "tok", expires_in: 3600 });
    if (url.includes("/crypto/receive-infos")) return J({ id: `recv-${++minted}`, data: { address: addrFor(minted) } });
    if (url.includes("/onchain/address")) return J({ address: `bc1q${(++minted).toString(36).padStart(38, "x")}` });
    if (url.includes("/invoice/add")) return J({ transactionId: `ln-${++minted}`, bolt11: "lnbc1fake", hash: "h" });
    if (url.includes("/transactions?")) {
      const page = Number(url.match(/page=(\d+)/)?.[1] ?? 1);
      // Page 1 is padded with 25 Lightning rows so the walk MUST turn the page to find the deposits.
      const ln = Array.from({ length: 25 }, (_, i) => ({ id: `ln-${i}`, currencyId: 0, transactionTypeId: 1, status: "completed", amount: 1000, createdAt: new Date().toISOString() }));
      const dep = deposits.map((d) => d.btc
        ? { id: d.id, currencyId: 0, transactionTypeId: 7, status: "completed", amount: Math.round(d.amount * 1e11), settledAt: "2026-09-10T20:09:16Z", createdAt: new Date().toISOString() } // BTC: msat
        : { id: d.id, currencyId: 30, transactionTypeId: 9, status: "completed", amount: d.amount, settledAt: "2026-09-10T20:09:16Z", createdAt: new Date().toISOString() });
      return J({ transactions: page === 1 ? ln : page === 2 ? dep : [] });
    }
    const det = url.match(/\/v2\/transaction\/([^/]+)\/details/);
    if (det) { const d = deposits.find((x) => x.id === det[1]); return d ? J({ networkId: d.hash }) : J({}, 404); }
    return J({}, 404);
  }
  if (url.includes("mempool.space/api/tx/")) {
    const txid = url.slice(url.lastIndexOf("/") + 1);
    const vout = btcTxs.get(txid);
    return vout ? J({ status: { confirmed: true }, vout }) : J({}, 404);
  }
  if (url.includes("ethereum-rpc.publicnode.com")) {
    if (rpcDown) return new Response("bad gateway", { status: 502 });
    const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as { params?: string[] };
    return J({ jsonrpc: "2.0", id: 1, result: receipts.get(body.params?.[0] ?? "") ?? null });
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { reconcileDeposits } = await import("../src/core/depositReconcile.js");
  const { transfersFromReceipt } = await import("../src/core/erc20.js");
  const { listUnattributed } = await import("../src/core/unattributed.js");
  const { store } = await import("../src/db/store.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "stable-reconcile" };
  const get = async (p: string) => (await (await fetch(`${base}${p}`, { headers: DEV })).json());
  const newPayment = async (xaf: number, phone: string) => {
    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf, method: "USDC", country: "CM" }) });
    const q = await r.json() as { id: string };
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({ quoteId: q.id, recipient: { phone, country: "CM", provider: "MTN" } }) });
    const p = await r.json() as { id: string; ref: string; payInstruction: { code: string; amount: number }; error?: string; message?: string };
    if (!p.payInstruction) throw new Error(`payment refused: ${r.status} ${p.error} ${p.message}`);
    return p;
  };
  const settled = async (id: string) => {
    for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 100)); const c = await get(`/api/payments/${id}`) as { state: string }; if (["DELIVERED", "FAILED", "MANUAL_REVIEW"].includes(c.state)) return c.state; }
    return (await get(`/api/payments/${id}`) as { state: string }).state;
  };

  try {
    console.log("\nStablecoin reconcile — the chain says which address a deposit paid");

    // Decoder on its own.
    const tr = transfersFromReceipt({ status: "0x1", logs: [log("0x" + "1".repeat(40), 370), { address: "0x" + "9".repeat(40), topics: [TRANSFER, pad("0x" + "1".repeat(40)), pad("0x" + "2".repeat(40))], data: "0x1" }, log("0x" + "2".repeat(40), 1.81)] });
    ok("decodes only USDT/USDC Transfer logs", tr.length === 2 && tr[1].amount === 1.81 && tr[1].asset === "USDC", JSON.stringify(tr));
    ok("a reverted receipt moves nothing", transfersFromReceipt({ status: "0x0", logs: [log("0x" + "1".repeat(40), 5)] }).length === 0);

    // 1. Two open payments; a batched exchange withdrawal pays the SECOND one, among strangers.
    const a = await newPayment(1000, "677000789");
    const b = await newPayment(1000, "677000598");
    ok("two open USDC payments with different addresses", a.payInstruction.code !== b.payInstruction.code);
    const hash1 = "0x" + "1".repeat(64);
    receipts.set(hash1, { status: "0x1", logs: [log("0x" + "a".repeat(40), 370), log("0x" + "b".repeat(40), 37310.799673), log(b.payInstruction.code, b.payInstruction.amount), log("0x" + "d".repeat(40), 24.848127)] });
    deposits.push({ id: "dep-1", amount: b.payInstruction.amount, hash: hash1 });
    await reconcileDeposits();
    ok("the payment whose address was paid settles", (await settled(b.id)) === "DELIVERED");
    ok("the other payment, same amount, is untouched", (await get(`/api/payments/${a.id}`) as { state: string }).state === "AWAITING_INBOUND");
    const pb = await store().getPayment(b.id);
    ok("the deposit id is remembered on the payment", (pb?.inboundEventIds ?? []).includes("dep-1"), JSON.stringify(pb?.inboundEventIds));
    const legs = (await get(`/api/ledger/${b.id}`) as unknown[]).length;
    await reconcileDeposits();
    ok("a second pass is idempotent", (await get(`/api/ledger/${b.id}`) as unknown[]).length === legs);

    // 2. RPC down → retried, never written off.
    const hash2 = "0x" + "2".repeat(64);
    receipts.set(hash2, { status: "0x1", logs: [log(a.payInstruction.code, a.payInstruction.amount)] });
    deposits.push({ id: "dep-2", amount: a.payInstruction.amount, hash: hash2 });
    rpcDown = true;
    await reconcileDeposits();
    ok("unreadable receipt: payment still open (retry next tick)", (await get(`/api/payments/${a.id}`) as { state: string }).state === "AWAITING_INBOUND");
    ok("…and NOT held as unattributed", !listUnattributed().some((u) => u.eventId === "dep-2"));
    rpcDown = false;
    await reconcileDeposits();
    ok("RPC back → it settles", (await settled(a.id)) === "DELIVERED");

    // 3. A deposit that pays no open payment (address reused / payment gone).
    const hash3 = "0x" + "3".repeat(64);
    receipts.set(hash3, { status: "0x1", logs: [log("0x" + "e".repeat(40), 1.81)] });
    deposits.push({ id: "dep-3", amount: 1.81, hash: hash3 });
    await reconcileDeposits();
    const u = listUnattributed().find((x) => x.eventId === "dep-3");
    ok("held as unattributed", !!u);
    ok("in whole tokens, as USDC — not 0.00000181 UNKNOWN_STABLECOIN", u?.amount === 1.81 && u?.asset === "USDC", `${u?.amount} ${u?.asset}`);
    ok("booked as a liability", Math.abs((await store().balance("refund_payable", "USDC")) - -1.81) < 1e-9, String(await store().balance("refund_payable", "USDC")));
    await reconcileDeposits();
    ok("not captured twice", listUnattributed().filter((x) => x.eventId === "dep-3").length === 1);

    // 4. No tx hash from the rail: amount settles only a SOLE candidate.
    const c = await newPayment(2500, "690111222");
    const d = await newPayment(2500, "691333444");
    deposits.push({ id: "dep-4", amount: c.payInstruction.amount, hash: null });
    await reconcileDeposits();
    ok("two candidates for one amount → nobody is guessed", (await get(`/api/payments/${c.id}`) as { state: string }).state === "AWAITING_INBOUND" && (await get(`/api/payments/${d.id}`) as { state: string }).state === "AWAITING_INBOUND");
    ok("…it is held for an operator instead", listUnattributed().some((x) => x.eventId === "dep-4"));
    const e = await newPayment(4000, "692555666");
    deposits.push({ id: "dep-5", amount: e.payInstruction.amount, hash: null });
    await reconcileDeposits();
    ok("a sole amount match settles", (await settled(e.id)) === "DELIVERED");

    // 5. A SECOND deposit to an address that already settled → attached to that payment as
    //    a refund owed (not delivered twice, not lost as unattributed).
    const hash6 = "0x" + "6".repeat(64);
    receipts.set(hash6, { status: "0x1", logs: [log(b.payInstruction.code, 3)] });
    deposits.push({ id: "dep-6", amount: 3, hash: hash6 });
    const legsB = (await get(`/api/ledger/${b.id}`) as unknown[]).length;
    await reconcileDeposits();
    const pb2 = await store().getPayment(b.id);
    ok("second deposit to a settled address stays on that payment", (pb2?.inboundEventIds ?? []).includes("dep-6") && pb2?.state === "DELIVERED", `${pb2?.state} ${JSON.stringify(pb2?.inboundEventIds)}`);
    ok("…noted as a refund owed", (pb2?.events ?? []).some((ev) => /refund owed/.test(ev.note ?? "")));
    ok("…booked as a liability, not delivered again", (await get(`/api/ledger/${b.id}`) as unknown[]).length === legsB + 2);
    ok("…and NOT as unattributed", !listUnattributed().some((x) => x.eventId === "dep-6"));

    // 6. USDT sent to a USDC address (same 0x, wrong token) → held with a clear reason.
    const f = await newPayment(1000, "693777888");
    const hash7 = "0x" + "7".repeat(64);
    const usdtLog = { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", topics: [TRANSFER, pad("0x" + "1".repeat(40)), pad(f.payInstruction.code)], data: "0x" + BigInt(Math.round(f.payInstruction.amount * 1e6)).toString(16).padStart(64, "0") };
    receipts.set(hash7, { status: "0x1", logs: [usdtLog] });
    deposits.push({ id: "dep-7", amount: f.payInstruction.amount, hash: hash7 });
    await reconcileDeposits();
    const pf = await get(`/api/payments/${f.id}`) as { state: string; events: Array<{ note?: string }> };
    ok("wrong token to the right address → MANUAL_REVIEW, never auto-paid", pf.state === "MANUAL_REVIEW", pf.state);
    ok("…and the note says which token went where", pf.events.some((ev) => /USDT was sent to this payment's USDC address/.test(ev.note ?? "")), pf.events.map((ev) => ev.note).join(" | "));

    // 7. On-chain BTC: the same backstop. IBEX lists the deposit (typeId 7, msat) with a txid;
    //    the explorer says which output paid our address; the payment re-prices to what arrived.
    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 20000, method: "ONCHAIN", country: "CM" }) });
    const qb = await r.json() as { id: string };
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({ quoteId: qb.id, recipient: { phone: "694888777", country: "CM", provider: "MTN" } }) });
    const pb3 = await r.json() as { id: string; payInstruction: { code: string; amount: number; method: string } };
    ok("an on-chain BTC payment was minted", pb3.payInstruction?.method === "ONCHAIN", pb3.payInstruction?.method);
    const txid = "a".repeat(64);
    btcTxs.set(txid, [{ scriptpubkey_address: "bc1qsomeoneelse000000000000000000000000000", value: 250_000 }, { scriptpubkey_address: pb3.payInstruction.code, value: Math.round(pb3.payInstruction.amount * 1e8) }]);
    deposits.push({ id: "dep-btc-1", amount: pb3.payInstruction.amount, hash: txid, btc: true });
    await reconcileDeposits();
    const cb3 = await settled(pb3.id);
    ok("…settles from the deposit list + explorer without any webhook", cb3 === "DELIVERED", cb3);
    const pb3full = await store().getPayment(pb3.id);
    ok("…deduped by the IBEX deposit id", (pb3full?.inboundEventIds ?? []).includes("dep-btc-1"));
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

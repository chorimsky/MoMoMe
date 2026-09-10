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
const deposits: Array<{ id: string; amount: number; hash: string | null }> = [];
const receipts = new Map<string, unknown>();
let rpcDown = false;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("poweredbyibex.io")) {
    if (url.includes("/oauth/token")) return J({ access_token: "tok", expires_in: 3600 });
    if (url.includes("/crypto/receive-infos")) return J({ id: `recv-${++minted}`, data: { address: addrFor(minted) } });
    if (url.includes("/transactions?")) return J({ transactions: deposits.map((d) => ({ id: d.id, currencyId: 30, transactionTypeId: 9, status: "completed", amount: d.amount, settledAt: "2026-09-10T20:09:16Z" })) });
    const det = url.match(/\/v2\/transaction\/([^/]+)\/details/);
    if (det) { const d = deposits.find((x) => x.id === det[1]); return d ? J({ networkId: d.hash }) : J({}, 404); }
    return J({}, 404);
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
  const { reconcileStablecoinDeposits } = await import("../src/core/stablecoinReconcile.js");
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
    await reconcileStablecoinDeposits();
    ok("the payment whose address was paid settles", (await settled(b.id)) === "DELIVERED");
    ok("the other payment, same amount, is untouched", (await get(`/api/payments/${a.id}`) as { state: string }).state === "AWAITING_INBOUND");
    const pb = await store().getPayment(b.id);
    ok("the deposit id is remembered on the payment", (pb?.inboundEventIds ?? []).includes("dep-1"), JSON.stringify(pb?.inboundEventIds));
    const legs = (await get(`/api/ledger/${b.id}`) as unknown[]).length;
    await reconcileStablecoinDeposits();
    ok("a second pass is idempotent", (await get(`/api/ledger/${b.id}`) as unknown[]).length === legs);

    // 2. RPC down → retried, never written off.
    const hash2 = "0x" + "2".repeat(64);
    receipts.set(hash2, { status: "0x1", logs: [log(a.payInstruction.code, a.payInstruction.amount)] });
    deposits.push({ id: "dep-2", amount: a.payInstruction.amount, hash: hash2 });
    rpcDown = true;
    await reconcileStablecoinDeposits();
    ok("unreadable receipt: payment still open (retry next tick)", (await get(`/api/payments/${a.id}`) as { state: string }).state === "AWAITING_INBOUND");
    ok("…and NOT held as unattributed", !listUnattributed().some((u) => u.eventId === "dep-2"));
    rpcDown = false;
    await reconcileStablecoinDeposits();
    ok("RPC back → it settles", (await settled(a.id)) === "DELIVERED");

    // 3. A deposit that pays no open payment (address reused / payment gone).
    const hash3 = "0x" + "3".repeat(64);
    receipts.set(hash3, { status: "0x1", logs: [log("0x" + "e".repeat(40), 1.81)] });
    deposits.push({ id: "dep-3", amount: 1.81, hash: hash3 });
    await reconcileStablecoinDeposits();
    const u = listUnattributed().find((x) => x.eventId === "dep-3");
    ok("held as unattributed", !!u);
    ok("in whole tokens, as USDC — not 0.00000181 UNKNOWN_STABLECOIN", u?.amount === 1.81 && u?.asset === "USDC", `${u?.amount} ${u?.asset}`);
    ok("booked as a liability", Math.abs((await store().balance("refund_payable", "USDC")) - -1.81) < 1e-9, String(await store().balance("refund_payable", "USDC")));
    await reconcileStablecoinDeposits();
    ok("not captured twice", listUnattributed().filter((x) => x.eventId === "dep-3").length === 1);

    // 4. No tx hash from the rail: amount settles only a SOLE candidate.
    const c = await newPayment(2500, "690111222");
    const d = await newPayment(2500, "691333444");
    deposits.push({ id: "dep-4", amount: c.payInstruction.amount, hash: null });
    await reconcileStablecoinDeposits();
    ok("two candidates for one amount → nobody is guessed", (await get(`/api/payments/${c.id}`) as { state: string }).state === "AWAITING_INBOUND" && (await get(`/api/payments/${d.id}`) as { state: string }).state === "AWAITING_INBOUND");
    ok("…it is held for an operator instead", listUnattributed().some((x) => x.eventId === "dep-4"));
    const e = await newPayment(4000, "692555666");
    deposits.push({ id: "dep-5", amount: e.payInstruction.amount, hash: null });
    await reconcileStablecoinDeposits();
    ok("a sole amount match settles", (await settled(e.id)) === "DELIVERED");
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

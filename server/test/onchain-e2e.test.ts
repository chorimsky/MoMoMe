/* Crypto → fiat, end to end, for ON-CHAIN — the path that silently could not complete.

   On-chain quotes are `estimateOnly`: a 10-60 minute confirmation window cannot honour a
   locked rate, so confirmInbound RE-PRICES at the current rate and refuses to price on a
   stale feed. That refusal is correct. What was missing is that NOTHING refreshed the feed
   at settlement time — ensureFreshRates ran only on /quotes, and only when liveMoney().
   Serverless has no FX poller and the Hobby cron is daily, so by settlement `ratesFresh()`
   was false essentially always and every on-chain payment held at MANUAL_REVIEW *after* the
   customer's crypto had already been booked to the ledger.

   Network is stubbed: the FX venues return fixed prices, so this asserts the refresh
   HAPPENS rather than depending on live markets. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

let fxPulls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) { fxPulls++; return J({ data: { amount: "65000.00" } }); }
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) { fxPulls++; return J({ data: { rates: { USD: "1.08" } } }); }
  if (url.includes("kraken.com")) { fxPulls++; return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } }); }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": `onchain-e2e-${Date.now()}` };
  const get = async (p: string) => (await (await fetch(`${base}${p}`, { headers: DEV })).json());

  try {
    console.log("\nCrypto → fiat, ON-CHAIN");
    const { ensureRatesFresh } = await import("../src/core/rates.js");
    await ensureRatesFresh();
    ok("a refresher is registered (jobs.ts wires fxTick)", fxPulls > 0, `${fxPulls} venue calls`);

    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 25000, method: "ONCHAIN", country: "CM" }) });
    const q = (await r.json()) as { id: string; xaf: number; feeXaf: number; totalXaf: number; estimateOnly: boolean };
    ok("quote issued", r.status === 200);
    ok("on-chain is quoted as an ESTIMATE (re-priced on confirmation)", q.estimateOnly === true);
    ok("fee math holds", q.xaf + q.feeXaf === q.totalXaf, `${q.xaf}+${q.feeXaf}=${q.totalXaf}`);

    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
      quoteId: q.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "On-chain E2E" } }) });
    const p = (await r.json()) as { id: string; ref: string; payInstruction: { method: string; code: string } };
    ok("payment created with an on-chain address", r.status === 200 && p.payInstruction.method === "ONCHAIN", String(p.payInstruction?.code).slice(0, 12));

    await fetch(`${base}/api/payments/${p.id}/simulate`, { method: "POST", headers: DEV });
    let cur: { state: string; events: Array<{ state: string; note?: string }> } | undefined;
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 200));
      cur = await get(`/api/payments/${p.id}`) as typeof cur;
      if (cur && ["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW"].includes(cur.state)) break;
    }
    const note = cur?.events.map((e) => e.note).filter(Boolean).join(" | ") ?? "";
    ok("settles to DELIVERED (was MANUAL_REVIEW: 'FX feed not fresh')", cur?.state === "DELIVERED", `${cur?.state} ${note}`);
    ok("never held for a stale feed", !note.includes("FX feed not fresh"));

    const led = await get(`/api/ledger/${p.id}`) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const net: Record<string, number> = {};
    for (const e of led) net[e.currency] = Math.round(((net[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)) * 1e9) / 1e9;
    ok("ledger balances in every currency", Object.values(net).every((v) => v === 0), JSON.stringify(net));
    ok("exactly one delivery leg", led.filter((e) => e.account === "external_recipient").length === 1);
    ok("fee revenue booked", led.filter((e) => e.account === "fee_revenue").length === 1);
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

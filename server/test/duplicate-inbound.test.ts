/* A SECOND deposit must never be silently kept.

   providerRef is the receive ADDRESS for every deposit method (on-chain BTC, ERC-20
   USDT/USDC), so it is identical across every payment ever sent to it. The settlement
   guard asked only "has this payment already booked an inbound?" and returned silently if
   so — which is right for a redelivered webhook and badly wrong for a real second payment:
   the crypto arrived, was never credited, never refunded, and was not even recorded.
   Delivering again is not the fix either — the recipient was paid once, for one order.

   So the rail's own deposit id now rides on the event: a repeat of the same deposit is
   ignored, and a NEW one is booked to refund_payable — an explicit liability — and noted
   on the payment for an operator. Only IBEX's HTTP surface is mocked. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_CLIENT_ID = "test-client";
process.env.IBEX_CLIENT_SECRET = "test-secret";
process.env.IBEX_ACCOUNT_ID = "btc-account";
process.env.IBEX_USDC_ACCOUNT_ID = "usdc-account";
process.env.IBEX_WEBHOOK_SECRET = "test-webhook-secret";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const ADDR = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("poweredbyibex.io")) {
    if (url.includes("/oauth/token")) return J({ access_token: "tok", expires_in: 3600 });
    if (url.includes("/crypto/receive-infos")) return J({ id: "recv-1", data: { address: ADDR } });
    return J({}, 404);
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

/** One USDC deposit, as IBEX reports it. `txId` identifies THIS deposit. */
const deposit = (txId: string, usdc: number) => JSON.stringify({
  secret: "test-webhook-secret",
  transaction: { id: txId, currencyId: 30, address: ADDR, amount: Math.round(usdc * 1e6), status: "settled", settledAt: new Date().toISOString() },
});

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "dup-inbound" };
  const IBEX_IP = { "content-type": "application/json", "x-forwarded-for": "35.243.242.121" };
  const get = async (p: string) => (await (await fetch(`${base}${p}`, { headers: DEV })).json());
  const netOf = (led: Array<{ account: string; direction: string; amount: number; currency: string }>, acct: string) =>
    led.filter((e) => e.account === acct).reduce((s, e) => s + (e.direction === "debit" ? e.amount : -e.amount), 0);

  try {
    console.log("\nDuplicate inbound — a second deposit becomes a debt, not a windfall");

    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 20000, method: "USDC", country: "CM" }) });
    const q = await r.json() as { id: string };
    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
      quoteId: q.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Dup Test" } }) });
    const pay = await r.json() as { id: string; ref: string; payInstruction: { code: string; amount: number; asset: string } };
    const amt = pay.payInstruction.amount;
    ok("payment created with an ERC-20 receive address", pay.payInstruction.code === ADDR, pay.payInstruction.code);

    // ---- deposit #1: the real payment ----
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: deposit("ibex-tx-1", amt) });
    let cur: { state: string; events: Array<{ note?: string }> } | undefined;
    for (let i = 0; i < 50; i++) {
      await new Promise((res) => setTimeout(res, 200));
      cur = await get(`/api/payments/${pay.id}`) as typeof cur;
      if (cur && ["DELIVERED", "FAILED", "MANUAL_REVIEW"].includes(cur.state)) break;
    }
    ok("the first deposit delivers Mobile Money", cur?.state === "DELIVERED", cur?.state);
    const led1 = await get(`/api/ledger/${pay.id}`) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const legs1 = led1.length;
    ok("no refund is owed yet", netOf(led1, "refund_payable") === 0);

    // ---- a REDELIVERED webhook for that same deposit: must change nothing ----
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: deposit("ibex-tx-1", amt) });
    await new Promise((res) => setTimeout(res, 700));
    const led2 = await get(`/api/ledger/${pay.id}`) as unknown[];
    ok("a replay of the SAME deposit posts nothing", led2.length === legs1, `${legs1} → ${led2.length}`);

    // ---- deposit #2: a genuinely new payment to the same address ----
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: deposit("ibex-tx-2", amt) });
    await new Promise((res) => setTimeout(res, 900));
    const led3 = await get(`/api/ledger/${pay.id}`) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const after = await get(`/api/payments/${pay.id}`) as { state: string; events: Array<{ note?: string }> };

    ok("the second deposit IS recorded (not silently kept)", led3.length > legs1, `${legs1} → ${led3.length}`);
    // The liability is what ACTUALLY arrived — base units divided back down, not the
    // pre-rounding quote figure. A credit shows as negative in this debit-positive sum.
    const received = Math.round(amt * 1e6) / 1e6;
    ok("it is booked as money we owe back, for the amount received",
      netOf(led3, "refund_payable") === -received, `${netOf(led3, "refund_payable")} vs -${received}`);
    ok("the books still balance", (() => {
      const net: Record<string, number> = {};
      for (const e of led3) net[e.currency] = Math.round(((net[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)) * 1e9) / 1e9;
      return Object.values(net).every((v) => v === 0);
    })());
    ok("it did NOT pay the recipient a second time",
      led3.filter((e) => e.account === "external_recipient").length === 1,
      `${led3.filter((e) => e.account === "external_recipient").length} delivery legs`);
    ok("the payment stays DELIVERED (the order was filled once)", after.state === "DELIVERED", after.state);
    ok("an operator can see why", after.events.some((e) => (e.note ?? "").includes("refund owed")),
      after.events.map((e) => e.note).filter(Boolean).slice(-1)[0] ?? "no note");

    // ---- the backstop path must not reopen the hole ----
    // The reconcile loop and the on-demand poll settle from an authoritative RE-QUERY, not
    // a webhook, so they have no deposit id to pass. That left the seen-list empty, and a
    // later real second deposit was then indistinguishable from a replay — silently kept,
    // which is exactly what this guard exists to prevent. Booking now always seeds the
    // list, falling back to the paid leg's providerRef.
    {
      const { store } = await import("../src/db/store.js");
      const settledByBackstop = (await store().listPayments()).find((x) => x.id === pay.id);
      ok("a settled payment always remembers at least one deposit id",
        (settledByBackstop?.inboundEventIds?.length ?? 0) > 0,
        JSON.stringify(settledByBackstop?.inboundEventIds));
    }

    // ---- the debt must also protect the treasury ----
    // A duplicate sits on a DELIVERED payment, and treasury's state-based scan counts a
    // DELIVERED payment's crypto as ours. Without refund_payable in the liability sum, an
    // operator could sweep the sender's money out to a cold wallet.
    {
      const { cryptoLiabilities } = await import("../src/core/treasury.js");
      const liab = await cryptoLiabilities();
      ok("the refund owed counts against what the treasury may sweep",
        Math.abs(liab.USDC - received) < 1e-9, `USDC liability ${liab.USDC} vs owed ${received}`);
    }

    // ---- and the second deposit is itself replay-safe ----
    const legs3 = led3.length;
    await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: deposit("ibex-tx-2", amt) });
    await new Promise((res) => setTimeout(res, 700));
    const led4 = await get(`/api/ledger/${pay.id}`) as unknown[];
    ok("replaying the second deposit does not double the debt", led4.length === legs3, `${legs3} → ${led4.length}`);
    // ---- the scenario that hole actually produced ----
    // Settle a payment WITHOUT a webhook (the backstop path: no deposit id), then have a
    // real deposit arrive. Before the seeding fix this was silently kept.
    {
      let r2 = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 20000, method: "USDC", country: "CM" }) });
      const q2 = await r2.json() as { id: string };
      r2 = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
        quoteId: q2.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Backstop" } }) });
      const p2 = await r2.json() as { id: string; payInstruction: { amount: number } };
      // /simulate settles with no deposit id, exactly like the reconcile backstop.
      await fetch(`${base}/api/payments/${p2.id}/simulate`, { method: "POST", headers: DEV });
      let st = "";
      for (let i = 0; i < 50; i++) {
        await new Promise((res) => setTimeout(res, 200));
        st = ((await get(`/api/payments/${p2.id}`)) as { state: string }).state;
        if (["DELIVERED", "FAILED", "MANUAL_REVIEW"].includes(st)) break;
      }
      ok("a payment settled without a webhook still delivers", st === "DELIVERED", st);
      const before2 = ((await get(`/api/ledger/${p2.id}`)) as unknown[]).length;
      // Now real crypto arrives for it.
      await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: deposit("ibex-tx-late", p2.payInstruction.amount) });
      await new Promise((res) => setTimeout(res, 900));
      const l2 = await get(`/api/ledger/${p2.id}`) as Array<{ account: string; direction: string; amount: number }>;
      const owed2 = l2.filter((e) => e.account === "refund_payable").reduce((s2, e) => s2 + (e.direction === "debit" ? e.amount : -e.amount), 0);
      ok("a real deposit after a backstop settle is NOT silently kept", l2.length > before2, `${before2} → ${l2.length}`);
      ok("…it is booked as a refund owed", owed2 < 0, String(owed2));
    }
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

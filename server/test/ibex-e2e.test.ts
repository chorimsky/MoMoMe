/* IBEX end-to-end: a payment driven through the REAL code path from quote to DELIVERED.

   The existing ibex.test.ts covers parseEvent / verifyWebhook / mocked network calls in
   isolation. This drives the whole chain over HTTP against createApp(): quote → payment
   (IBEX mints the instruction) → provider webhook → authoritative re-query → settlement →
   payout → DELIVERED → balanced double-entry ledger. Only IBEX's own HTTP surface is
   mocked; every layer of ours is real.

   Runs with IBEX_ENV=sandbox and IBEX_ALLOW_SANDBOX_PAYOUT unset, so trusted() is false:
   the inbound is not real money and the payout takes the simulated rail, letting the flow
   reach DELIVERED without any live credential. (IBEX sandbox Lightning invoices are
   payable with REAL mainnet sats, which is exactly why this test never touches the live
   API.) */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_CLIENT_ID = "test-client";
process.env.IBEX_CLIENT_SECRET = "test-secret";
process.env.IBEX_ACCOUNT_ID = "test-account";
process.env.IBEX_WEBHOOK_SECRET = "test-webhook-secret";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const BOLT11 = "lnbc10u1pjtest0edge0invoice0payload0forthe0e2e0test";
const TXID = "ibex-txn-e2e-0001";
let settled = false;               // flips when the "customer pays"
const calls: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes("poweredbyibex.io")) {
    calls.push(url.replace(/^https?:\/\/[^/]+/, ""));
    const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (url.includes("/oauth/token")) return J({ access_token: "tok-123", expires_in: 3600 });
    if (url.includes("/invoice/add")) return J({ transactionId: TXID, bolt11: BOLT11, hash: "h" });
    if (url.includes("/transaction/")) {
      // Authoritative re-query — the webhook body alone never settles a payment.
      // NOTE the shape: GET /v2/transaction/{id} returns the transaction fields at the
      // TOP level, whereas the webhook body wraps them in { transaction: {...} }. Getting
      // this wrong makes settled=false and the payment silently never completes.
      return J({ id: TXID, settledAt: settled ? new Date().toISOString() : null,
        invoice: { state: { name: settled ? "SETTLED" : "OPEN" },
          settleDateUtc: settled ? new Date().toISOString() : null,
          receiveMsat: settled ? 1_000_000 : 0 } });
    }
    return J({}, 404);
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

const webhookBody = (extra: Record<string, unknown> = {}) => JSON.stringify({
  secret: "test-webhook-secret",
  transaction: { id: TXID, transactionTypeId: 1, settledAt: new Date().toISOString(),
    invoice: { state: { name: "SETTLED" }, settleDateUtc: new Date().toISOString(), receiveMsat: 1_000_000 }, ...extra },
});

async function main() {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "ibex-e2e-device" };
  const IBEX_IP = { "content-type": "application/json", "x-forwarded-for": "35.243.242.121" }; // documented sandbox sender

  try {
    console.log("\nIBEX end-to-end — quote → invoice → webhook → settle → payout → ledger");

    // 1. Quote + payment: the instruction must come from IBEX, not the sandbox rail.
    let r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 20000, method: "LIGHTNING", country: "CM" }) });
    const quote = (await r.json()) as { id: string };
    ok("quote issued", r.status === 200 && !!quote.id);

    r = await fetch(`${base}/api/payments`, { method: "POST", headers: DEV, body: JSON.stringify({
      quoteId: quote.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "IBEX E2E" } }) });
    const pay = (await r.json()) as { id: string; ref: string; state: string; payInstruction: { code: string; provider: string; providerRef: string; qr: string } };
    ok("payment created", r.status === 200, String(r.status));
    ok("instruction minted by IBEX", pay.payInstruction?.provider === "ibex", pay.payInstruction?.provider);
    ok("bolt11 returned to the customer", pay.payInstruction?.code === BOLT11);
    ok("QR uses the lightning: URI scheme", pay.payInstruction?.qr === `lightning:${BOLT11}`);
    ok("providerRef is the IBEX transaction id (webhook match key)", pay.payInstruction?.providerRef === TXID);
    ok("IBEX authenticated then created the invoice", calls.some((c) => c.includes("/oauth/token")) && calls.some((c) => c.includes("/invoice/add")));

    // 2. Webhook rejection paths — these gate real settlement.
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: JSON.stringify({ secret: "wrong", transaction: { id: TXID } }) });
    ok("wrong shared secret → 401", r.status === 401, String(r.status));
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" }, body: webhookBody() });
    ok("sender IP not on IBEX's allowlist → 401", r.status === 401, String(r.status));

    // 3. A VALID webhook while IBEX still reports the invoice OPEN must NOT settle:
    //    the body is only a trigger, the re-query is authoritative.
    settled = false;
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: webhookBody() });
    ok("valid webhook accepted (acks fast)", r.status === 200, String(r.status));
    await new Promise((res) => setTimeout(res, 600));
    let cur = (await (await fetch(`${base}/api/payments/${pay.id}`, { headers: DEV })).json()) as { state: string };
    ok("re-query says unpaid → NOT settled (forged webhook cannot pay out)", cur.state === "AWAITING_INBOUND", cur.state);

    // 4. Customer actually pays → the same webhook now settles the whole chain.
    settled = true;
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: webhookBody() });
    ok("settled webhook accepted", r.status === 200);

    let state = "";
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 250));
      cur = (await (await fetch(`${base}/api/payments/${pay.id}`, { headers: DEV })).json()) as { state: string };
      state = cur.state;
      if (["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW"].includes(state)) break;
    }
    ok("settles all the way to DELIVERED", state === "DELIVERED", state);

    // 5. The books must balance — this is the actual money invariant.
    const led = (await (await fetch(`${base}/api/ledger/${pay.id}`, { headers: DEV })).json()) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const net: Record<string, number> = {};
    for (const e of led) net[e.currency] = Math.round(((net[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)) * 1e9) / 1e9;
    ok("BTC debits == credits", net.BTC === 0, String(net.BTC));
    ok("XAF debits == credits", net.XAF === 0, String(net.XAF));
    ok("exactly one delivery leg", led.filter((e) => e.account === "external_recipient").length === 1);
    ok("inbound booked exactly once", led.filter((e) => e.account === "inbound_clearing").length === 1);

    // 6. Re-delivered webhook (providers retry) must not double-settle.
    const before = led.length;
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP, body: webhookBody() });
    await new Promise((res) => setTimeout(res, 800));
    const led2 = (await (await fetch(`${base}/api/ledger/${pay.id}`, { headers: DEV })).json()) as unknown[];
    ok("duplicate webhook does not re-post the ledger", led2.length === before, `${before} → ${led2.length}`);

    // 7. An expired/cancelled invoice event is ignored outright.
    r = await fetch(`${base}/webhooks/ibex`, { method: "POST", headers: IBEX_IP,
      body: JSON.stringify({ secret: "test-webhook-secret", transaction: { id: "other-tx", invoice: { state: { name: "CANCEL" } } } }) });
    const j = (await r.json()) as { ignored?: boolean; unmatched?: boolean };
    ok("CANCEL/expired event ignored, never settles", r.status === 200 && (j.ignored || j.unmatched) === true);
  } finally {
    server.close();
  }
  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

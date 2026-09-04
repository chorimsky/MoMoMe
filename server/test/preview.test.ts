/* "Choose how to pay" — the sender was picking blind.

   The step listed a name and a vague subtitle. The methods are not interchangeable: the FX
   spread is configured PER METHOD, so the same XAF buys a different amount of crypto
   depending on the choice, and settlement times differ by orders of magnitude — seconds on
   Lightning against block confirmations on-chain. Someone choosing "best for large amounts"
   had no way to learn it might take an hour, or that the miner fee comes out of their own
   wallet on top of what we quote.

   The preview is deliberately STATELESS. A quote is single-use, so pricing three options by
   issuing three quotes would burn two of them. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

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
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { store } = await import("../src/db/store.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "preview-test" };

  try {
    console.log("\nChoose how to pay — the figures behind the choice\n");

    const r = await (await fetch(`${base}/api/preview?xaf=25000`, { headers: H })).json() as any;
    ok("every enabled method is priced", Array.isArray(r.methods) && r.methods.length >= 3,
       r.methods?.map((m: any) => m.method).join(","));
    ok("the fee matches the quote's own arithmetic", r.feeXaf === Math.round(25000 * getSettings().pricing.feePct),
       `${r.feeXaf}`);
    ok("the total is amount plus fee", r.totalXaf === 25000 + r.feeXaf);

    const ln = r.methods.find((m: any) => m.method === "LIGHTNING");
    const oc = r.methods.find((m: any) => m.method === "ONCHAIN");
    ok("each option says what the sender actually sends", !!ln?.amountLabel && !!oc?.amountLabel,
       `${ln?.amountLabel} / ${oc?.amountLabel}`);
    ok("…as a real amount, not zero", ln.amount > 0 && oc.amount > 0);

    // The reason the screen needs this at all.
    ok("Lightning settles in seconds, on-chain does not", ln.etaSeconds < 60 && oc.etaSeconds >= 600,
       `${ln.etaSeconds}s vs ${oc.etaSeconds}s`);
    ok("Lightning costs the sender no network fee", ln.senderPaysNetworkFee === false);
    ok("…but on-chain and stablecoins do, from their own wallet", oc.senderPaysNetworkFee === true);
    const usdt = r.methods.find((m: any) => m.method === "USDT");
    ok("USDT also warns about gas", usdt?.senderPaysNetworkFee === true);

    /* ---- it must mint NOTHING: a quote is single-use ---- */
    const before = (await store().listPayments()).length;
    await fetch(`${base}/api/preview?xaf=25000`, { headers: H });
    await fetch(`${base}/api/preview?xaf=25000`, { headers: H });
    ok("pricing the options creates no payments", (await store().listPayments()).length === before);
    // A quote id would be the giveaway that state was minted.
    ok("…and returns no quote id", !("id" in r) && !r.methods.some((m: any) => "id" in m));

    /* ---- a disabled method must not be offered ---- */
    updateSettings({ methods: { ...getSettings().methods, USDT: false } });
    const r2 = await (await fetch(`${base}/api/preview?xaf=25000`, { headers: H })).json() as any;
    ok("a method the operator switched off is not priced",
       !r2.methods.some((m: any) => m.method === "USDT"), r2.methods.map((m: any) => m.method).join(","));
    updateSettings({ methods: { ...getSettings().methods, USDT: true } });

    /* ---- amounts must be refused outside the product's range ---- */
    ok("below the minimum is refused", (await fetch(`${base}/api/preview?xaf=100`, { headers: H })).status === 400);
    ok("above the maximum is refused", (await fetch(`${base}/api/preview?xaf=99999999`, { headers: H })).status === 400);
    ok("a non-numeric amount is refused", (await fetch(`${base}/api/preview?xaf=abc`, { headers: H })).status === 400);
    ok("a missing amount is refused", (await fetch(`${base}/api/preview`, { headers: H })).status === 400);

    /* ---- the figures must agree with the quote the sender then gets ---- */
    const q = await (await fetch(`${base}/api/quotes`, {
      method: "POST", headers: H, body: JSON.stringify({ xaf: 25000, method: "LIGHTNING", country: "CM" }),
    })).json() as any;
    ok("the preview and the real quote agree on the fee", q.feeXaf === r.feeXaf, `${q.feeXaf} vs ${r.feeXaf}`);
    ok("…and on what the sender sends", q.inboundAmountLabel === ln.amountLabel,
       `${q.inboundAmountLabel} vs ${ln.amountLabel}`);
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();

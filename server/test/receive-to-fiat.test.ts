/* Receive-to-fiat, end to end — and the NON-CUSTODY invariant.

   Every Mobile-Money number is reachable as <number>@momome.xyz. Paying that address must
   convert and deliver Mobile Money in ONE pass: MoMo›Me never holds a crypto balance on
   anyone's behalf. That is a product boundary with regulatory weight, not a preference —
   holding customer sats is custody, a materially different activity from converting in
   flight — so it is asserted here rather than left to convention.

   The strongest form of the assertion is the LEDGER: after delivery, every account that
   could represent value owed to a customer must net to zero. Crypto in, fiat out, nothing
   resting. A future change that starts crediting a customer balance fails this test.

   Drives the real LNURL routes over HTTP against createApp(); no network. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PUBLIC_URL = "https://example.test";

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

const PHONE = "677000789";

async function main() {
  const { createApp } = await import("../src/app.js");
  const { ensureRatesFresh } = await import("../src/core/rates.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "receive-e2e" };
  const getJson = async (p: string, h: Record<string, string> = DEV) => (await (await fetch(`${base}${p}`, { headers: h })).json());

  try {
    console.log("\nReceive to fiat — <number>@momome.xyz → Mobile Money, nothing held");
    await ensureRatesFresh().catch(() => {});

    // 1. LUD-16: the number resolves as a Lightning Address.
    const pr = await getJson(`/.well-known/lnurlp/${PHONE}`) as { tag?: string; callback?: string; minSendable?: number; maxSendable?: number; reason?: string };
    ok("the number IS a Lightning Address (LUD-16 payRequest)", pr.tag === "payRequest", pr.reason ?? pr.tag ?? "");
    ok("it advertises a callback for this number", !!pr.callback?.endsWith(`/lnurl/pay/${PHONE}`), pr.callback ?? "");
    ok("it advertises a sendable range", (pr.minSendable ?? 0) > 0 && (pr.maxSendable ?? 0) > (pr.minSendable ?? 0));

    // The identity layer advertises the address WITH the dial code (237677000789@…) while
    // the LNURL metadata uses the national form. Both must resolve, or the address shown to
    // a customer in the console is one an external wallet cannot pay.
    const withCc = await getJson(`/.well-known/lnurlp/237${PHONE}`) as { tag?: string };
    ok("the dial-code form of the address resolves too", withCc.tag === "payRequest", String(withCc.tag));

    // 2. LUD-06: paying it mints a real invoice AND opens a delivery.
    const msat = 2_000_000; // 2000 sat
    const cb = await getJson(`/lnurl/pay/${PHONE}?amount=${msat}`) as { pr?: string; reason?: string };
    ok("callback returns a bolt11 to pay", typeof cb.pr === "string" && cb.pr.startsWith("lnbc"), cb.reason ?? String(cb.pr).slice(0, 18));

    // Find the payment the callback opened (source=lnurl, senderId scoped to the address).
    const SND = { ...DEV, "x-mm-sender": `lnurl:${PHONE}@momome.xyz` };
    const all = await getJson("/api/payments", SND) as Array<{ id: string; ref: string; state: string; source?: string; recipient: { phone: string } }>;
    const pay = all.find((p) => p.source === "lnurl" && p.recipient.phone === PHONE);
    ok("a delivery to that Mobile Money number was opened", !!pay, pay?.ref ?? "none");
    if (!pay) throw new Error("no lnurl payment created");
    ok("it starts awaiting the inbound (nothing delivered yet)", pay.state === "AWAITING_INBOUND", pay.state);

    // 3. The sender pays → it settles all the way to Mobile Money.
    await fetch(`${base}/api/payments/${pay.id}/simulate`, { method: "POST", headers: SND });
    let cur: { state: string } | undefined;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      cur = await getJson(`/api/payments/${pay.id}`, SND) as { state: string };
      if (["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW"].includes(cur.state)) break;
    }
    ok("received sats are delivered as Mobile Money", cur?.state === "DELIVERED", cur?.state);

    // 4. THE NON-CUSTODY INVARIANT. Crypto came in and fiat went out in one pass, so no
    //    account may be left holding value for the customer.
    const led = await getJson(`/api/ledger/${pay.id}`, SND) as Array<{ account: string; direction: string; amount: number; currency: string }>;
    const net: Record<string, number> = {};
    for (const e of led) net[e.currency] = Math.round(((net[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)) * 1e9) / 1e9;
    ok("the books balance in every currency", Object.values(net).every((v) => v === 0), JSON.stringify(net));
    // customer_wallet EXISTS as an account, and that is fine — it is a TRANSIT account,
    // credited when the crypto confirms and debited again the moment FX locks. The
    // non-custody guarantee is not "never touched", it is "never left holding anything":
    // it must net to exactly zero. A change that starts parking value there — the first
    // step toward custody — breaks this line.
    const netOf = (acct: string) => (ccy: string) => led
      .filter((e) => e.account === acct && e.currency === ccy)
      .reduce((sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount), 0);
    const wallet = netOf("customer_wallet");
    ok("value passes THROUGH the customer account (it is a transit leg)",
      led.filter((e) => e.account === "customer_wallet").length === 2,
      `${led.filter((e) => e.account === "customer_wallet").length} legs`);
    ok("…and nothing is left resting in it — NON-CUSTODY", wallet("BTC") === 0 && wallet("XAF") === 0,
      `BTC ${wallet("BTC")}, XAF ${wallet("XAF")}`);
    ok("the value left the platform to the recipient", led.some((e) => e.account === "external_recipient" && e.currency === "XAF"));
    ok("the crypto that arrived is accounted against the outside world (inbound_clearing)",
      netOf("inbound_clearing")("BTC") > 0, String(netOf("inbound_clearing")("BTC")));

    // 5. The identity carries a receive address and NO holdable balance — the shape is the
    //    guarantee: there is no field for customer crypto to accumulate in.
    const id = (await getJson("/api/admin/identities", { ...DEV, "x-admin-token": "none" })) as unknown;
    const rec = Array.isArray(id) ? (id as Array<Record<string, unknown>>).find((i) => String(i.phone) === PHONE) : undefined;
    if (rec) {
      ok("identity exposes a Lightning receive address", typeof rec.lightningAddress === "string" && String(rec.lightningAddress).includes("@"));
      ok("identity has NO custodial wallet ref", !("lnWalletRef" in rec), Object.keys(rec).filter((k) => k.includes("Wallet")).join(","));
      ok("identity has NO crypto balances to hold", !("balances" in rec));
      ok("it records delivered history instead", typeof rec.receivedXaf === "number", String(rec.receivedXaf));
    } else {
      console.log("  · admin identities not readable unauthenticated — shape asserted by types");
    }
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

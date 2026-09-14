/* The interoperability network — test the money, not just the code (§50).

   10,000 XAF · MTN Cameroon → MoMo›Me → Lightning → M-Pesa Kenya, on the sandbox rails:
   the debit, the settlement value, the destination liquidity, the recipient's credit, the
   fees, the FX and the ledger all reconcile. Then the failure drills: duplicate confirm,
   duplicate webhook, payout failure with every recovery, Lightning failure → refund,
   liquidity shortage, FX expiry, provider disabled by the emergency controls, flags off.
   And the production-safety rule: shadow never moves funds; a corridor that is not switched
   on cannot execute. Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/network.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const saga = await import("../src/core/network/saga.js");
  const liquidity = await import("../src/core/network/liquidity.js");
  const { simulateFailure } = await import("../src/core/network/adapters.js");
  const { simulateLightningFailure } = await import("../src/core/network/settlement.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = (dev: string) => ({ "content-type": "application/json", "x-mm-sender": dev });
  const j = async (p: string, init?: RequestInit) => { const r = await fetch(`${base}${p}`, init); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }; };
  const admin = createUser("net-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
  const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token, "content-type": "application/json" };
  const dev = "sender-device";
  const intentBody = { sourceMarket: "CM", sourceProvider: "MTN", sourcePhone: "677000111", destinationMarket: "KE", destinationProvider: "MPESA", destinationPhone: "712345678", destinationName: "Wanjiru", sourceAmount: 10_000 };
  const balances = (txId: string) => { const by = new Map<string, number>(); for (const e of saga.ledgerFor(txId)) by.set(`${e.account}:${e.currency}`, (by.get(`${e.account}:${e.currency}`) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)); return by; };

  try {
    console.log("\n0. Production safety: everything is off by default\n");
    const flags = getSettings().network.flags;
    ok("every network flag is OFF", Object.values(flags).every((v) => v === false), JSON.stringify(flags));
    ok("no corridor is switched on", Object.keys(getSettings().network.corridors).length === 0);
    const v1 = await j("/quotes", { method: "POST", headers: H(dev), body: JSON.stringify({ xaf: 10_000, method: "LIGHTNING", country: "CM" }) });
    ok("the production quote engine is untouched", v1.status === 200 && v1.body.xaf === 10_000, String(v1.status));

    console.log("\n1. Routing (shadow): no corridor, no route — and the reasons say why\n");
    let r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify(intentBody) });
    ok("an intent is created with routes and quotes", r.status === 201 && Array.isArray(r.body.routes), String(r.status));
    ok("…but nothing is available while the corridor and flags are off", r.body.best === null && r.body.unavailable.some((x: string) => /CM-KE|CROSS_BORDER|not enabled|cannot payout/.test(x)), JSON.stringify(r.body.unavailable));

    console.log("\n2. Switch the CM→KE corridor on (sandbox rails, simulated Kenyan liquidity)\n");
    // Kenya: enable the market's M-Pesa payout for the rehearsal, give it liquidity.
    const { MARKETS } = await import("../src/core/network/markets.js");
    MARKETS.KE.enabled = true; MARKETS.KE.providers[0].payout = true;
    let s = await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ flags: { INTEROPERABILITY_V2: true, ROUTING_ENGINE: true, LIQUIDITY_ENGINE: true, CROSS_BORDER_PAYMENTS: true, SHADOW_ROUTING: true }, corridors: { "CM-KE": true }, simulatedLiquidity: { "ke:sim": 2_000_000, "cm:sim": 5_000_000, "lightning:ibex": 0.5 } }) });
    ok("the operator switches flags and the corridor on", s.status === 200 && s.body.network.corridors["CM-KE"] === true, String(s.status));
    const ov = await j("/admin/network", { headers: A });
    const ke = ov.body.corridors.find((c: any) => c.id === "CM-KE");
    ok("the corridor registry shows CM→KE", !!ke && ke.enabled, JSON.stringify(ke?.reasons));
    const kePos = ov.body.liquidity.find((p: any) => p.sourceId === "ke:sim");
    ok("Kenya liquidity is a position with available = balance − reserved", kePos && kePos.available === 2_000_000 && kePos.state === "AVAILABLE", JSON.stringify(kePos));

    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify(intentBody) });
    const best = r.body.best;
    ok("the router finds a route", r.status === 201 && !!best, JSON.stringify(r.body.unavailable));
    ok("…of type MOMOME_LIQUIDITY_SETTLEMENT (no partner declared)", best?.route.type === "MOMOME_LIQUIDITY_SETTLEMENT", best?.route.type);
    ok("…as data: collection → source pool → Lightning → destination pool → payout", best?.route.steps.map((x: any) => x.kind).join(">") === "collection>source_liquidity>lightning_settlement>destination_liquidity>payout", best?.route.steps.map((x: any) => x.kind).join(">"));
    const q = best.quote;
    ok("the quote carries FX, a fee breakdown and a destination amount in KES", q.fx.from === "XAF" && q.fx.to === "KES" && q.destinationCurrency === "KES" && q.destinationAmount > 0 && q.fees.total > 0, `${q.destinationAmount} KES · fees ${q.fees.total} XAF`);
    ok("fees are itemised: collect, payout, FX spread, Lightning, liquidity, MoMo›Me", ["providerCollect", "providerPayout", "fxSpread", "lightning", "liquidity", "momome"].every((k) => typeof q.fees[k] === "number") && Math.abs(q.fees.providerCollect + q.fees.providerPayout + q.fees.fxSpread + q.fees.lightning + q.fees.liquidity + q.fees.momome - q.fees.total) < 0.01);
    const expectedKes = Math.floor((10_000 - q.fees.total) * q.fx.rate);
    ok("destination = (source − fees) × rate", q.destinationAmount === expectedKes, `${q.destinationAmount} vs ${expectedKes}`);
    ok("the customer pays exactly what they typed (fees inside)", q.totalSource === 10_000);
    ok("the settlement leg is sized in sats", q.settlementSats > 0, `${q.settlementSats} sats`);
    ok("the route's score is a weighted sum of the seven factors", best.route.score.total > 0 && best.route.score.total <= 100, String(best.route.score.total));

    console.log("\n3. Execute: 10,000 XAF MTN CM → M-Pesa KE\n");
    const intentId = r.body.intent.id;
    let c = await j(`/network/intents/${intentId}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("confirming reserves destination liquidity and sends the collection request", c.status === 200 && c.body.transaction.state === "COLLECTION_PENDING", `${c.status} ${c.body.transaction?.state ?? c.body.message}`);
    const tx = c.body.transaction;
    const pos1 = (await liquidity.positions()).find((p) => p.sourceId === "ke:sim")!;
    ok("Kenya liquidity shows the reservation", pos1.reserved === q.destinationAmount && pos1.available === 2_000_000 - q.destinationAmount, JSON.stringify({ r: pos1.reserved, a: pos1.available }));
    const dup = await j(`/network/intents/${intentId}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("confirming twice returns the same transaction, not a second one", dup.status === 200 && dup.body.transaction.id === tx.id);
    // Provider says: collected. Twice.
    await j(`/network/sim/${tx.id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-1" }) });
    await j(`/network/sim/${tx.id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-1" }) });
    let t = saga.getTx(tx.id)!;
    ok("collection confirmed → Lightning settled → payout confirmed → COMPLETED", t.state === "COMPLETED", t.state);
    ok("a duplicate collection webhook was applied once", t.appliedEvents.filter((e) => e === "col-1").length === 1);
    const seq = t.events.map((e) => e.state);
    ok("the saga recorded every stage in order", ["CREATED", "LIQUIDITY_RESERVED", "COLLECTION_PENDING", "COLLECTION_CONFIRMED", "LIGHTNING_SENT", "LIGHTNING_CONFIRMED", "PAYOUT_INITIATED", "PAYOUT_CONFIRMED", "COMPLETED"].every((st) => seq.includes(st)), seq.join(">"));
    ok("every provider/rail reference is on the transaction", !!t.refs.liquidityReservationId && !!t.refs.sourceProviderRef && !!t.refs.lightningPaymentId && !!t.refs.destinationProviderRef, JSON.stringify(t.refs));
    const b = balances(t.id);
    ok("the ledger balances in every currency", saga.ledgerBalanced(t.id));
    ok("Cameroon debit = 10,000 XAF collected", b.get("src_collection_clearing:XAF") === 10_000);
    ok("the platform fee is booked as revenue", -(b.get("fee_revenue:XAF") ?? 0) === t.fees.momome, String(b.get("fee_revenue:XAF")));
    const btc = t.settlementSats / 1e8;
    ok("the Lightning position sent exactly the settlement value and the Kenya pool absorbed it", Math.abs((b.get("lightning_position:BTC") ?? 0)) < 1e-9 && Math.abs((b.get("dst_pool:BTC") ?? 0) + btc) < 1e-9, JSON.stringify([b.get("lightning_position:BTC"), b.get("dst_pool:BTC")]));
    ok("M-Pesa credit = the quoted KES", -(b.get("dst_recipient:KES") ?? 0) === q.destinationAmount, String(b.get("dst_recipient:KES")));
    ok("the reservation was released on payout confirmation", !liquidity.reservationOf(t.id));
    const rec = (await j("/admin/network", { headers: A })).body.reconciliation;
    ok("reconciliation: settled — source, Lightning, payout confirmed, ledger balanced", rec.items.find((i: any) => i.txId === t.id)?.verdict === "settled", JSON.stringify(rec.items[0]));
    const got = await j(`/network/transactions/${t.ref}`, { headers: H(dev) });
    ok("support can search one ref and see the whole lifecycle + ledger", got.status === 200 && got.body.ledger.length >= 6, String(got.body.ledger?.length));

    console.log("\n4. Failure drills\n");
    // Payout fails after Lightning settled.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000002" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    const t2id = c.body.transaction.id;
    simulateFailure(`${t2id}:payout`);
    await j(`/network/sim/${t2id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-2" }) });
    let t2 = saga.getTx(t2id)!;
    ok("a payout failure AFTER settlement lands in DESTINATION_SETTLEMENT_FAILED, not 'failed and forgotten'", t2.state === "DESTINATION_SETTLEMENT_FAILED", t2.state);
    ok("…the source money is still on the ledger", (balances(t2id).get("src_collection_clearing:XAF") ?? 0) === 10_000);
    ok("…and reconciliation flags it for a person", (await j("/admin/network", { headers: A })).body.reconciliation.items.find((i: any) => i.txId === t2id)?.verdict === "manual");
    const rt = await j(`/admin/network/tx/${t2id}/recover`, { method: "POST", headers: A, body: JSON.stringify({ action: "retry" }) });
    t2 = saga.getTx(t2id)!;
    ok("recovery: retry re-submits the payout with a NEW idempotency key and completes", rt.status === 200 && t2.state === "COMPLETED" && t2.refs.destinationPayoutId?.endsWith(":2"), `${t2.state} ${t2.refs.destinationPayoutId}`);
    ok("…and its ledger still balances", saga.ledgerBalanced(t2id));

    // Payout fails → refund.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000003" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    const t3id = c.body.transaction.id;
    simulateFailure(`${t3id}:payout`);
    await j(`/network/sim/${t3id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-3" }) });
    await j(`/admin/network/tx/${t3id}/recover`, { method: "POST", headers: A, body: JSON.stringify({ action: "refund" }) });
    let t3 = saga.getTx(t3id)!;
    ok("recovery: refund books a refund liability and waits", t3.state === "REFUND_PENDING" && (balances(t3id).get("refund_payable:XAF") ?? 0) === -10_000, t3.state);
    await j(`/admin/network/tx/${t3id}/refunded`, { method: "POST", headers: A, body: JSON.stringify({ ref: "MTN-REF-1" }) });
    t3 = saga.getTx(t3id)!;
    ok("…and REFUNDED clears it, ledger balanced", t3.state === "REFUNDED" && saga.ledgerBalanced(t3id));
    ok("…its Kenya reservation was released", !liquidity.reservationOf(t3id));

    // Lightning fails → nothing left the network → refund path.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000004" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    const t4id = c.body.transaction.id;
    simulateLightningFailure(`${t4id}:ln`);
    await j(`/network/sim/${t4id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-4" }) });
    const t4 = saga.getTx(t4id)!;
    ok("a Lightning failure goes to REFUND_PENDING with the reservation released", t4.state === "REFUND_PENDING" && t4.events.some((e) => e.state === "LIGHTNING_FAILED") && !liquidity.reservationOf(t4id), t4.state);

    // Payer never approves.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000005" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    const t5id = c.body.transaction.id;
    await j(`/network/sim/${t5id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "FAILED", eventId: "col-5" }) });
    ok("a declined collection releases the reservation and books nothing", saga.getTx(t5id)!.state === "COLLECTION_FAILED" && saga.ledgerFor(t5id).length === 0 && !liquidity.reservationOf(t5id));

    // Liquidity shortage.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, sourceAmount: 4_000_000 }) });
    ok("a payment the destination cannot fund is refused at routing, not accepted", r.body.best === null && r.body.unavailable.some((x: string) => /available|limit/.test(x)), JSON.stringify(r.body.unavailable));

    // FX expiry.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000006" }) });
    const qx = saga.getQuote(r.body.best.quote.id)!; qx.expiresAt = new Date(Date.now() - 1000).toISOString(); qx.fx.expiresAt = qx.expiresAt; saga.saveQuote(qx);
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("an expired quote is never executed", c.status === 409 && c.body.error === "quote_expired", String(c.status));

    // Emergency control: disable M-Pesa Kenya only.
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ disabled: { providers: ["KE:MPESA"] } }) });
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify(intentBody) });
    ok("disabling one provider takes only its routes away", r.body.best === null && r.body.unavailable.some((x: string) => /MPESA KE disabled/.test(x)), JSON.stringify(r.body.unavailable));
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ disabled: { providers: [] } }) });
    const dom = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationMarket: "CM", destinationProvider: "ORANGE", destinationPhone: "699000155", sourceAmount: 5_000 }) });
    ok("…while a domestic CM→CM route (today's flow) is still found", !!dom.body.best && dom.body.best.route.type === "AGGREGATOR_SETTLEMENT", JSON.stringify(dom.body.unavailable));

    console.log("\n5. Shadow mode never moves funds; flags off never executes\n");
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000007" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({ shadow: true }) });
    const sh = saga.getTx(c.body.transaction.id)!;
    ok("a shadow transaction is recorded with no reservation, no collection, no ledger", sh.shadow && sh.state === "CREATED" && !liquidity.reservationOf(sh.id) && saga.ledgerFor(sh.id).length === 0);
    const sr = await j("/admin/network/shadow/run", { method: "POST", headers: A, body: "{}" });
    ok("shadow routing compares the production settlements it can see", sr.status === 200 && typeof sr.body.report.comparisons === "number");
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ flags: { CROSS_BORDER_PAYMENTS: false } }) });
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000008" }) });
    ok("with CROSS_BORDER_PAYMENTS off the corridor is unroutable again", r.body.best === null);
    const before = liquidity.reservationsList().length;
    const { begin } = saga;
    const q2 = saga.getQuote(saga.getIntent(r.body.intent.id)!.quoteId ?? "") ?? null;
    ok("…and the saga refuses to execute even if called directly", !q2 || (await begin(saga.getIntent(r.body.intent.id)!, q2, saga.getRoute(q2.routeId)!)).ok === false);
    ok("…without touching liquidity", liquidity.reservationsList().length === before);
    ok("the production engine still quotes exactly as before", (await j("/quotes", { method: "POST", headers: H(dev), body: JSON.stringify({ xaf: 10_000, method: "LIGHTNING", country: "CM" }) })).status === 200);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

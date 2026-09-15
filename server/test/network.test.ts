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
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
process.env.LEGACY_SENDER_UNTIL = "2000-01-01T00:00:00Z"; // the migration window is OVER: a bare device id proves nothing

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("currency=USD")) return J({ data: { rates: { KES: "129.40", GHS: "15.55", NGN: "1580.2", XOF: "600", EUR: "0.93" } } });
  if (url.includes("open.er-api.com")) return J({ result: "success", rates: { KES: 129.9, GHS: 15.5, NGN: 1575, UGX: 3700 } });
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
  // Devices: enrolled P-256 keys, every request signed the way the apps sign (device-signing.test).
  const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
  const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwk = (priv: Uint8Array) => { const pub = p256.getPublicKey(priv, false); return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) }; };
  const keys = new Map<string, Uint8Array>();
  const enroll = async (dev: string) => { const k = p256.utils.randomSecretKey(); keys.set(dev, k); const r = await fetch(`${base}/me/devices`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": dev }, body: JSON.stringify({ authPub: jwk(k), wrapPub: jwk(p256.utils.randomSecretKey()) }) }); if (r.status !== 200) throw new Error(`enrol ${dev}: ${r.status}`); };
  const H = (dev: string) => ({ "content-type": "application/json", "x-mm-sender": dev });
  const j = async (p: string, init?: RequestInit) => {
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    const priv = headers["x-mm-sender"] ? keys.get(headers["x-mm-sender"]) : undefined;
    if (priv) {
      const ts = String(Date.now()), body = typeof init?.body === "string" ? init.body : "";
      const msg = new TextEncoder().encode(`${(init?.method ?? "GET").toUpperCase()}\n${p}\n${ts}\n${b64(sha256(new TextEncoder().encode(body)))}`);
      headers["x-mm-ts"] = ts; headers["x-mm-sig"] = b64(p256.sign(sha256(msg), priv, { prehash: false, lowS: true }));
    }
    const r = await fetch(`${base}${p}`, { ...init, headers });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
  };
  const admin = createUser("net-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
  const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token, "content-type": "application/json" };
  const dev = "sender-device", other = "other-device";
  await enroll(dev); await enroll(other);
  const intentBody = { sourceMarket: "CM", sourceProvider: "MTN", sourcePhone: "677000111", destinationMarket: "KE", destinationProvider: "MPESA", destinationPhone: "712345678", destinationName: "Wanjiru", sourceAmount: 10_000 };
  const balances = (txId: string) => { const by = new Map<string, number>(); for (const e of saga.ledgerFor(txId)) by.set(`${e.account}:${e.currency}`, (by.get(`${e.account}:${e.currency}`) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)); return by; };

  try {
    console.log("\n0. Production safety: everything is off by default\n");
    const flags = getSettings().network.flags;
    ok("every network flag is OFF", Object.values(flags).every((v) => v === false), JSON.stringify(flags));
    ok("no corridor is switched on", Object.keys(getSettings().network.corridors).length === 0);
    const v1 = await j("/quotes", { method: "POST", headers: H(dev), body: JSON.stringify({ xaf: 10_000, method: "LIGHTNING", country: "CM" }) });
    ok("the production quote engine is untouched", v1.status === 200 && v1.body.xaf === 10_000, String(v1.status));
    const cfg0 = await j("/config");
    ok("/config says the network is closed to customers", cfg0.body.network?.enabled === false, JSON.stringify(cfg0.body.network));
    ok("…and the public market list has no destination", (await j("/network/markets")).body.destinations?.length === 0);

    console.log("\n1. Routing (shadow): no corridor, no route — and the reasons say why\n");
    const bare = await fetch(`${base}/network/intents`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": "nobody-enrolled" }, body: JSON.stringify(intentBody) });
    ok("the network surface refuses an unsigned device id (same gate as /api)", bare.status === 401, String(bare.status));
    let r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify(intentBody) });
    ok("an intent is created with routes and quotes", r.status === 201 && Array.isArray(r.body.routes), String(r.status));
    ok("…but nothing is available while the corridor and flags are off", r.body.best === null && r.body.unavailable.some((x: string) => /CM-KE|CROSS_BORDER|not enabled|cannot payout/.test(x)), JSON.stringify(r.body.unavailable));

    console.log("\n2. Switch the CM→KE corridor on (sandbox rails, simulated Kenyan liquidity)\n");
    // Kenya: the operator enables the market and M-Pesa payout — configuration, no code.
    const badM = await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ markets: { KE: { providers: { SAFARICOM: { payout: true } } } } }) });
    ok("an unknown provider id is refused", badM.status === 400 && badM.body.error === "bad_provider", String(badM.status));
    const badCM = await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ markets: { CM: { enabled: false } } }) });
    ok("Cameroon (the live engine) cannot be switched off as a market", badCM.status === 400, String(badCM.status));
    let s = await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ flags: { INTEROPERABILITY_V2: true, ROUTING_ENGINE: true, LIQUIDITY_ENGINE: true, CROSS_BORDER_PAYMENTS: true, SHADOW_ROUTING: true }, corridors: { "CM-KE": true }, markets: { KE: { enabled: true, providers: { MPESA: { payout: true } } } }, canary: { allowlist: [dev], rolloutPct: 0 }, simulatedLiquidity: { "ke:sim": 2_000_000, "cm:sim": 5_000_000, "lightning:ibex": 0.5 } }) });
    ok("the operator switches flags, the market, the corridor and the canary device on", s.status === 200 && s.body.network.corridors["CM-KE"] === true && s.body.network.markets.KE.enabled === true && s.body.network.markets.KE.providers.MPESA.payout === true, String(s.status));
    const { market } = await import("../src/core/network/markets.js");
    ok("the market table reflects the override without a deploy", market("KE")!.enabled && market("KE")!.providers.find((p) => p.id === "MPESA")!.payout === true);
    const fxr = await j("/admin/network/fx/refresh", { method: "POST", headers: A, body: "{}" });
    ok("the public USD table prices KES from two independent venues (Coinbase, checked by open.er-api), not the configured figure", fxr.status === 200 && fxr.body.feed.rates.KES?.source === "public:coinbase+open.er-api" && Math.abs(fxr.body.feed.rates.KES.rate - 129.4) < 1e-9 && fxr.body.divergent.length === 0, JSON.stringify(fxr.body.feed.rates.KES));
    ok("…a currency only the check venue carries is still priced", fxr.body.feed.rates.UGX?.rate === 3700);
    const { mergeVenues } = await import("../src/core/network/fx.js");
    const mv = mergeVenues({ KES: 129.4, GHS: 15.5 }, { KES: 135, GHS: 15.6 });
    ok("two venues more than 2 % apart flag the currency as divergent — it cannot price real money", mv.divergent.join() === "KES" && mv.rates.KES === 129.4 && mv.rates.GHS === 15.5, JSON.stringify(mv));
    const cfgOn = await j("/config");
    ok("/config tells the customer surfaces the network is open", cfgOn.body.network?.enabled === true, JSON.stringify(cfgOn.body.network));
    const mkts = await j("/network/markets");
    ok("the public market list carries Kenya · M-Pesa with the corridor's amount bounds", mkts.status === 200 && mkts.body.destinations.length === 1 && mkts.body.destinations[0].code === "KE" && mkts.body.destinations[0].providers.map((p: any) => p.id).join() === "MPESA" && mkts.body.source.providers.length === 2, JSON.stringify(mkts.body.destinations));
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
    const expectedKes = Math.floor((10_000 - q.fees.total) * q.fx.mid);
    ok("destination = (source − fees) × MID rate — the spread is itemised, never taken twice", q.destinationAmount === expectedKes && q.fx.mid > q.fx.rate, `${q.destinationAmount} vs ${expectedKes}`);
    ok("only recipient + payout fee cross the border; every other fee stays at source", q.settlementSource === 10_000 - q.fees.total + q.fees.providerPayout, String(q.settlementSource));
    ok("the customer pays exactly what they typed (fees inside)", q.totalSource === 10_000);
    ok("the settlement leg is sized in sats", q.settlementSats > 0, `${q.settlementSats} sats`);
    ok("the route's score is a weighted sum of the seven factors", best.route.score.total > 0 && best.route.score.total <= 100, String(best.route.score.total));

    console.log("\n3. Execute: 10,000 XAF MTN CM → M-Pesa KE\n");
    const intentId = r.body.intent.id;
    let c = await j(`/network/intents/${intentId}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("confirming reserves destination liquidity and sends the collection request", c.status === 200 && c.body.transaction.state === "COLLECTION_PENDING", `${c.status} ${c.body.transaction?.state ?? c.body.message}`);
    const tx = c.body.transaction;
    const pos1 = (await liquidity.positions()).find((p) => p.sourceId === "ke:sim")!;
    const reserveKes = q.destinationAmount + Math.ceil(q.fees.providerPayout * q.fx.mid);
    ok("Kenya liquidity reserves the recipient's amount PLUS the aggregator's payout fee", pos1.reserved === reserveKes && pos1.available === 2_000_000 - reserveKes, JSON.stringify({ r: pos1.reserved, a: pos1.available, expected: reserveKes }));
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
    ok("fees retained at source are booked as revenue (platform, collection, spread, liquidity, Lightning)", Math.abs(-(b.get("fee_revenue:XAF") ?? 0) - (t.fees.total - t.fees.providerPayout)) < 0.01, String(b.get("fee_revenue:XAF")));
    ok("the source pool nets to zero: collected = settled + retained", Math.abs(b.get("src_pool:XAF") ?? 0) < 0.01, String(b.get("src_pool:XAF")));
    ok("the destination pool paid the recipient AND the aggregator's fee out of the sats it absorbed", (b.get("dst_pool:KES") ?? 0) === t.destination.amount + Math.ceil(t.fees.providerPayout * t.fx.mid) && -(b.get("provider_fees:KES") ?? 0) === Math.ceil(t.fees.providerPayout * t.fx.mid), JSON.stringify([b.get("dst_pool:KES"), b.get("provider_fees:KES")]));
    const btc = t.settlementSats / 1e8;
    ok("the Lightning position sent exactly the settlement value (plus its routing fee) and the Kenya pool absorbed it", Math.abs((b.get("lightning_position:BTC") ?? 0) + (b.get("lightning_fees:BTC") ?? 0)) < 1e-9 && Math.abs((b.get("dst_pool:BTC") ?? 0) + btc) < 1e-9, JSON.stringify([b.get("lightning_position:BTC"), b.get("lightning_fees:BTC"), b.get("dst_pool:BTC")]));
    ok("M-Pesa credit = the quoted KES", -(b.get("dst_recipient:KES") ?? 0) === q.destinationAmount, String(b.get("dst_recipient:KES")));
    ok("the reservation was released on payout confirmation", !liquidity.reservationOf(t.id));
    const rec = (await j("/admin/network", { headers: A })).body.reconciliation;
    ok("reconciliation: settled — source, Lightning, payout confirmed, ledger balanced", rec.items.find((i: any) => i.txId === t.id)?.verdict === "settled", JSON.stringify(rec.items[0]));
    const got = await j(`/network/transactions/${t.ref}`, { headers: H(dev) });
    ok("support can search one ref and see the whole lifecycle + ledger", got.status === 200 && got.body.ledger.length >= 6, String(got.body.ledger?.length));
    const notMine = await j(`/network/transactions/${t.ref}`, { headers: H(other) });
    ok("another enrolled device cannot see it", notMine.status === 404, String(notMine.status));

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
    const again5 = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("…and the same intent can be tried again with a NEW transaction (no money moved)", again5.status === 200 && again5.body.transaction.id !== t5id && again5.body.transaction.state === "COLLECTION_PENDING", `${again5.status} ${again5.body.transaction?.id}`);
    await j(`/network/sim/${again5.body.transaction.id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "FAILED", eventId: "col-5b" }) });

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

    // Payer number vs stated provider.
    const mism = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, sourceProvider: "ORANGE" }) });
    ok("a payer number on MTN cannot be collected as Orange", mism.status === 400 && mism.body.error === "bad_phone", `${mism.status} ${mism.body.message}`);
    const derived = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, sourceProvider: undefined }) });
    ok("…and the provider is derived from the number when not stated", derived.status === 201 && derived.body.intent.sourceProvider === "MTN");
    // Parked, then recovered.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000009" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    const t7id = c.body.transaction.id;
    simulateFailure(`${t7id}:payout`);
    await j(`/network/sim/${t7id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-7" }) });
    await j(`/admin/network/tx/${t7id}/recover`, { method: "POST", headers: A, body: JSON.stringify({ action: "manual" }) });
    ok("an operator can park a failed payout for review", saga.getTx(t7id)!.state === "MANUAL_REVIEW");
    const rt7 = await j(`/admin/network/tx/${t7id}/recover`, { method: "POST", headers: A, body: JSON.stringify({ action: "retry" }) });
    ok("…and retry it from review — it is not a dead end", rt7.status === 200 && saga.getTx(t7id)!.state === "COMPLETED" && saga.ledgerBalanced(t7id), saga.getTx(t7id)!.state);

    console.log("\n4b. Canary controls and the activation checklist\n");
    r = await j("/network/intents", { method: "POST", headers: H(other), body: JSON.stringify({ ...intentBody, destinationPhone: "712000010" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(other), body: JSON.stringify({}) });
    ok("a device outside the allowlist with 0 % rollout is refused at execution", c.status === 403 && c.body.error === "canary_refused", `${c.status} ${c.body.message}`);
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ canary: { maxPerTx: { "CM-KE": 5_000 } } }) });
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000011" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("above the per-transaction cap is refused even for an allowlisted device", c.status === 403 && /per-transaction cap/.test(c.body.message), `${c.status} ${c.body.message}`);
    const vol = saga.corridorVolume24h("CM-KE");
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ canary: { maxPerTx: { "CM-KE": 0 }, maxPerDay: { "CM-KE": vol + 5_000 } } }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("the rolling daily cap counts what already executed (refunds and declines excluded)", c.status === 403 && /daily cap/.test(c.body.message) && vol === 40_000, `${c.status} ${c.body.message} · volume ${vol}`);
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ canary: { maxPerDay: { "CM-KE": 1_000_000 }, maxPerTx: { "CM-KE": 50_000 } } }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    ok("within the caps the same intent executes", c.status === 200 && c.body.transaction.state === "COLLECTION_PENDING", `${c.status} ${c.body.message ?? ""}`);
    const badC = await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ canary: { rolloutPct: 250 } }) });
    ok("a rollout share outside 0–100 is refused", badC.status === 400);
    const { rolloutBucket } = saga;
    ok("the rollout bucket is stable per device and spans 0–99", rolloutBucket(dev) === rolloutBucket(dev) && rolloutBucket(dev) >= 0 && rolloutBucket(dev) < 100);
    const cl = await j("/admin/network/corridors/CM-KE/checklist", { headers: A });
    const it = (k: string) => cl.body.items.find((x: any) => x.key === k);
    ok("the activation checklist is computed from the same facts the router uses", cl.status === 200 && Array.isArray(cl.body.items) && cl.body.items.length >= 15, String(cl.body.items?.length));
    ok("…market, provider, corridor, FX, caps and flags pass", ["market_src", "market_dst", "providers_dst", "corridor_on", "fx_live", "cap_tx", "cap_day", "canary_who", "flag_CROSS_BORDER_PAYMENTS"].every((k) => it(k)?.ok === true), JSON.stringify(cl.body.items.filter((x: any) => !x.ok).map((x: any) => x.key)));
    ok("…but a simulated rail can never make a corridor READY", it("rail_payout")?.ok === false && it("rail_payout")?.severity === "must" && cl.body.ready === false && cl.body.stage === "not_configured", `${cl.body.stage} · ${it("rail_payout")?.detail}`);
    const ov2 = await j("/admin/network", { headers: A });
    ok("the overview carries the checklists, the FX feed and the canary controls", ov2.body.checklists.some((x: any) => x.corridor === "CM-KE") && ov2.body.fx.fresh === true && ov2.body.canary.allowlist.includes(dev) && ov2.body.marketOverrides.KE.enabled === true);
    const bad404 = await j("/admin/network/corridors/CM-ZZ/checklist", { headers: A });
    ok("an unknown corridor is a 404", bad404.status === 404);

    console.log("\n4c. Time-driven saga: expiry, late collection, automated refunds\n");
    const { networkTick } = await import("../src/core/network/monitor.js");
    ok("a Lightning failure books the refund liability the moment it lands", (balances(t4id).get("refund_payable:XAF") ?? 0) === -10_000 && saga.ledgerBalanced(t4id), String(balances(t4id).get("refund_payable:XAF")));
    // Expiry: the payer never approves; 31 minutes pass.
    r = await j("/network/intents", { method: "POST", headers: H(dev), body: JSON.stringify({ ...intentBody, destinationPhone: "712000020" }) });
    c = await j(`/network/intents/${r.body.intent.id}/confirm`, { method: "POST", headers: H(dev), body: JSON.stringify({}) });
    const t6id = c.body.transaction.id;
    ok("a pending collection is left alone before the timeout", (await networkTick()) >= 1 && saga.getTx(t6id)!.state === "COLLECTION_PENDING", saga.getTx(t6id)!.state);
    const t6 = saga.getTx(t6id)!; const pendingEv = t6.events.find((e) => e.state === "COLLECTION_PENDING")!; pendingEv.at = new Date(Date.now() - 31 * 60_000).toISOString();
    await networkTick();
    ok("after collectionTimeoutMin the collection expires and the reservation is released", saga.getTx(t6id)!.state === "COLLECTION_FAILED" && !liquidity.reservationOf(t6id) && saga.ledgerFor(t6id).length === 0, saga.getTx(t6id)!.state);
    // …then the provider says the money was collected after all.
    await j(`/network/sim/${t6id}/collection`, { method: "POST", headers: H(dev), body: JSON.stringify({ status: "COMPLETED", eventId: "col-late" }) });
    ok("a collection that lands after expiry is booked and routed to a refund, never lost", saga.getTx(t6id)!.state === "REFUND_PENDING" && (balances(t6id).get("src_collection_clearing:XAF") ?? 0) === 10_000 && (balances(t6id).get("refund_payable:XAF") ?? 0) === -10_000, saga.getTx(t6id)!.state);
    await networkTick();
    ok("with autoRefund OFF the refund waits for an operator", saga.getTx(t6id)!.state === "REFUND_PENDING" && !saga.getTx(t6id)!.refs.refundPayoutId);
    const badT = await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ collectionTimeoutMin: 2 }) });
    ok("a collection timeout under 5 min is refused", badT.status === 400);
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ autoRefund: true }) });
    await networkTick();
    const t6r = saga.getTx(t6id)!, t4r = saga.getTx(t4id)!;
    ok("with autoRefund ON the payer is paid back on the source rail and the transaction is REFUNDED", t6r.state === "REFUNDED" && t6r.refs.refundPayoutId === `${t6id}:refund` && !!t6r.refs.refundRef && saga.ledgerBalanced(t6id), `${t6r.state} ${t6r.refs.refundPayoutId}`);
    ok("…every open liability is closed: refund_payable and the clearing account are zero", (balances(t6id).get("refund_payable:XAF") ?? 0) === 0 && (balances(t6id).get("src_collection_clearing:XAF") ?? 0) === 0);
    ok("…the earlier Lightning-failure refund was paid the same way", t4r.state === "REFUNDED" && t4r.refs.refundPayoutId === `${t4id}:refund` && saga.ledgerBalanced(t4id), t4r.state);
    const again = await saga.submitRefund(t6r);
    ok("a second submit for the same transaction is a no-op (idempotent key)", again.ok === false && again.error === "not_refund_pending");
    await j("/admin/network/settings", { method: "PUT", headers: A, body: JSON.stringify({ autoRefund: false }) });
    const tk = await j("/admin/network/tick", { method: "POST", headers: A, body: "{}" });
    ok("an operator can run the monitor now", tk.status === 200 && typeof tk.body.examined === "number");
    const { listNotifications } = await import("../src/core/notifications.js");
    const notes = listNotifications(500);
    const forT1 = notes.filter((n) => n.paymentRef === t.ref);
    ok("the sender is told when it is delivered (push, once)", new Set(forT1.filter((n) => n.kind === "transfer_delivered" && n.audience === "sender").map((n) => n.body)).size === 1, JSON.stringify(forT1.map((n) => [n.kind, n.audience])));
    const forT2 = notes.filter((n) => n.paymentRef === saga.getTx(t2id)!.ref);
    ok("a payout failure after settlement alerts the operator and tells the sender it is being checked", forT2.some((n) => n.kind === "manual_review" && n.audience === "operator") && forT2.some((n) => n.kind === "manual_review" && n.audience === "sender"));
    const forT6 = notes.filter((n) => n.paymentRef === t6r.ref);
    ok("a refund is announced to the operator, then confirmed to the sender", forT6.some((n) => n.kind === "transfer_failed" && n.audience === "operator") && new Set(forT6.filter((n) => n.audience === "sender" && n.kind === "transfer_failed").map((n) => n.body)).size === 2, JSON.stringify(forT6.map((n) => [n.kind, n.audience])));

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

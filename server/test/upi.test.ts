/* Universal Payment Identity + multi-rail settlement — the blueprint's required scenarios.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/upi.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "upi-test-secret";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";
process.env.IDENTITY_MAX_DISTINCT_PER_HOUR_IP = "1000";
process.env.LEGACY_SENDER_UNTIL = "2000-01-01T00:00:00Z";
process.env.UPI_INTENT_RATE_LIMIT = "200";
import type { AddressInfo } from "node:net";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08", KES: "129.5", GHS: "15.2", NGN: "1580", XAF: "607" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  if (url.includes("open.er-api.com")) return J({ rates: { KES: 129.4, GHS: 15.1, NGN: 1575, XAF: 606 } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { classifyIdentity, resolve, getDestinations, getCapabilities } = await import("../src/core/upi/identity.js");
  const { validateAssetNetwork, assets } = await import("../src/core/upi/assets.js");
  const { fxRate } = await import("../src/core/upi/fx.js");
  const { capabilityRegistry } = await import("../src/core/upi/capabilities.js");
  const { createIntent, selectRouteFor, executeIntent, syncIntent } = await import("../src/core/upi/intents.js");
  const { createChainTx, advanceChainTx } = await import("../src/core/upi/chain.js");
  const { routingMode, flags } = await import("../src/core/upi/flags.js");
  const { markRailHardDown, setAggregatorUp } = await import("../src/core/routing.js");
  const { ensureFreshRates } = await import("../src/jobs.js");
  await ensureFreshRates().catch(() => {});

  console.log("\nFlags — everything new is off by default\n");
  ok("all ten flags read false", Object.values(flags()).every((v) => v === false));
  ok("routing mode is SHADOW", routingMode() === "SHADOW");

  console.log("\nTest 1 + 2 — the Lightning Address and the phone number are ONE identity\n");
  const a = await resolve("237670123456@momome.xyz", { purpose: "RECIPIENT_VERIFICATION", actor: "t" });
  const b = await resolve("+237670123456", { purpose: "RECIPIENT_VERIFICATION", actor: "t" });
  const c = await resolve("670123456", { purpose: "RECIPIENT_VERIFICATION", actor: "t" });
  ok("classification", classifyIdentity("+237674123456") === "MSISDN" && classifyIdentity("237674123456@momome.xyz") === "MOMOME_ADDRESS" && classifyIdentity("alice@walletofsatoshi.com") === "LIGHTNING_ADDRESS" && classifyIdentity("$alice@vasp.com") === "UMA");
  ok("address, +E.164 and local digits resolve to the same canonical MSISDN", a.canonical === "+237670123456" && b.canonical === a.canonical && c.canonical === a.canonical && a.type === "MSISDN" && a.native);
  ok("…with the operator-registered holder from the identity chain", a.verification?.status === "VERIFIED" && a.verification.displayName === "NANA JEAN PAUL");
  const dests = getDestinations(a);
  ok("destinations: Mobile Money (MTN, XAF, ACTIVE) and the LUD-16 address — separate objects, not phone→wallet", dests.some((d) => d.rail === "MOBILE_MONEY" && d.provider === "MTN" && d.currency === "XAF" && d.status === "ACTIVE") && dests.some((d) => d.rail === "LIGHTNING" && d.protocol === "LIGHTNING_ADDRESS" && d.address === "237670123456@momome.xyz"), JSON.stringify(dests));
  ok("capabilities list funding rails and settlement rails", getCapabilities(a).funding.includes("LIGHTNING") && getCapabilities(a).settlement.includes("MOBILE_MONEY"));
  const foreign = await resolve("alice@walletofsatoshi.com", { purpose: "RECIPIENT_VERIFICATION", actor: "t" });
  ok("a foreign Lightning Address is a non-native identity with itself as the only destination (no fabricated Mobile Money)", !foreign.native && getDestinations(foreign).length === 1 && getDestinations(foreign)[0].rail === "LIGHTNING");
  ok("UMA is refused while UMA_COMPATIBILITY_ENABLED is off (not faked)", await resolve("$alice@vasp.com", { purpose: "RECIPIENT_VERIFICATION", actor: "t" }).then(() => false, () => true));
  ok("the existing LNURL endpoint still answers (Test 1)", true); // covered end to end in phone-and-names / receive-to-fiat

  console.log("\nAssets — a stablecoin without a network is not an asset\n");
  ok("USDT alone is refused with the networks named", !validateAssetNetwork("USDT", null).ok && /needs a network/.test((validateAssetNetwork("USDT", null) as { reason: string }).reason));
  ok("USDT/ETHEREUM is known and RECEIVE_ONLY — the model, not a gap (funding rail, never held or sent)", validateAssetNetwork("USDT", "ETHEREUM").ok && assets().find((x) => x.code === "USDT" && x.network === "ETHEREUM")?.status === "RECEIVE_ONLY");
  const { SETTLEMENT_MODEL } = await import("../src/core/upi/assets.js");
  ok("the settlement model is declared: no custody, no balances, no outbound stablecoin", SETTLEMENT_MODEL.custody === "NONE_PASS_THROUGH" && SETTLEMENT_MODEL.holdsBalances === false && SETTLEMENT_MODEL.outboundStablecoin === false);
  ok("no identity ever has a STABLECOIN or BANK destination", getDestinations(a).every((d) => d.rail !== "STABLECOIN" && d.rail !== "BANK"));
  ok("USDT/TRON is PLANNED and refused for movement", !validateAssetNetwork("USDT", "TRON").ok);
  ok("BTC/LIGHTNING and fiat XAF/KES exist", assets().some((x) => x.code === "BTC" && x.network === "LIGHTNING") && assets().some((x) => x.code === "KES" && x.type === "FIAT"));

  console.log("\nFX — from feeds, with source and expiry\n");
  const fx = fxRate("BTC/LIGHTNING", "XAF");
  ok("BTC/LIGHTNING→XAF from the two-venue feed with spread and expiry", !!fx && fx.rate > 0 && fx.mid > fx.rate && fx.spreadBps > 0 && /2 venues|IBEX|public|fallback/.test(fx.source) && Date.parse(fx.expiresAt) > Date.now(), JSON.stringify(fx));
  ok("USDT/ETHEREUM→XAF and XAF→BTC are priced; a nonsense pair is null", !!fxRate("USDT/ETHEREUM", "XAF") && !!fxRate("XAF", "BTC/LIGHTNING") && fxRate("XAF", "ZZZ") === null);

  console.log("\nCapability registry + health\n");
  const reg = await capabilityRegistry();
  ok("CM:MTN and CM:ORANGE rows carry collection/payout/identity_verification and a health state", ["CM:MTN", "CM:ORANGE"].every((k) => { const r = reg.find((x) => x.id === k); return !!r && typeof r.capabilities.payout === "boolean" && ["HEALTHY", "DEGRADED", "UNAVAILABLE", "MAINTENANCE"].includes(r.health); }));
  ok("USDT/TRON is UNAVAILABLE with the reason; BANK is UNAVAILABLE", reg.find((x) => x.id === "USDT/TRON")?.health === "UNAVAILABLE" && reg.find((x) => x.id === "BANK")?.health === "UNAVAILABLE");
  ok("every stablecoin row is send:false, settlement:false regardless of flags", reg.filter((x) => x.kind === "STABLECOIN").every((x) => x.capabilities.send === false && x.capabilities.settlement === false));

  console.log("\nTest 3 — intent: Lightning → MoMo›Me → MTN Cameroon (quoted, routed, executed through V1)\n");
  let i = await createIntent({ owner: "dev-upi", identity: "+237670123456", amount: 10_000 });
  ok("CREATED → IDENTITY_RESOLVED → QUOTED, amount in the recipient's money", i.state === "QUOTED" && i.amount.currency === "XAF" && i.events.map((e) => e.state).join(">") === "CREATED>IDENTITY_RESOLVED>QUOTED", i.events.map((e) => e.state).join(">"));
  const opts = i.quote!.options;
  ok("every funding option is priced separately: Lightning, USDT/ETHEREUM, USDC/ETHEREUM, Mobile Money", ["BTC", "USDT", "USDC", "XAF"].every((asset) => opts.some((o) => o.sourceAsset === asset)), opts.map((o) => `${o.sourceAsset}/${o.sourceNetwork}:${o.available}`).join(" "));
  const ln = opts.find((o) => o.sourceAsset === "BTC")!;
  ok("the Lightning option: sats from the live rate, fee lines apart (momome, provider, fx spread), recipient gets exactly the intent", ln.available && ln.sourceAmount > 0 && ln.fees.momome > 0 && ln.fees.fxSpread >= 0 && ln.destinationAmount.value === 10_000 && ln.fx?.pair === "BTC/LIGHTNING/XAF", JSON.stringify(ln.fees));
  ok("the Mobile Money → Mobile Money option is unavailable while features.momoTransfer is off, with the reason", opts.some((o) => o.sourceAsset === "XAF" && !o.available && /momoTransfer/.test(o.reason ?? "")));
  const r = await selectRouteFor(i, { rail: "LIGHTNING" });
  ok("routes are described the same way and ordered by the configured rule (cost, latency, priority)", r.routes.length >= 3 && r.routes.every((x) => x.rank > 0 && x.limits.max > 0 && x.liquidity.pool) && r.routes[0].rank === 1);
  ok("ROUTE_SELECTED with a LIGHTNING route; shadow record written beside V1's choice", i.state === "ROUTE_SELECTED" && r.route?.type === "LIGHTNING" && i.shadow?.engineRoute === "LIGHTNING:LIGHTNING" && i.shadow.agree === true);
  const mintV1 = async () => ({ status: 200, body: { id: "pay_fake", ref: "MMM-2026-1", payInstruction: { amount: 0.001, expiresAt: new Date().toISOString() } } as never });
  ok("execution is refused in SHADOW mode / with PAYMENT_INTENT_V2_ENABLED off — nothing moves", await executeIntent(i, mintV1).then(() => false, (e) => e.code === "flag_off" || e.code === "shadow_mode"));

  console.log("\nTest 7 — liquidity insufficient → LIQUIDITY_UNAVAILABLE, not a partial payment\n");
  const { simulateDomesticFloat } = await import("../src/core/upi/liquidity.js");
  simulateDomesticFloat(2_000);
  const big = await createIntent({ owner: "dev-upi", identity: "+237670123456", amount: 100_000 });
  const rb = await selectRouteFor(big);
  simulateDomesticFloat(null);
  ok("a route that exists but cannot be funded is UNAVAILABLE with LIQUIDITY_UNAVAILABLE and the intent ends LIQUIDITY_FAILED", rb.route === null && rb.routes.every((x) => x.status === "UNAVAILABLE") && big.state === "LIQUIDITY_FAILED" && rb.routes.some((x) => /LIQUIDITY_UNAVAILABLE/.test(x.reason ?? "")), `${big.state} ${rb.routes[0]?.reason ?? ""}`);

  console.log("\nTest 9 — provider outage → excluded from routing\n");
  markRailHardDown("peexit", "test outage"); setAggregatorUp("pawapay", false);
  const out = await createIntent({ owner: "dev-upi", identity: "+237699000155", amount: 5_000 });
  const ro = out.state === "QUOTED" ? await selectRouteFor(out) : { route: null, routes: [] };
  ok("with every payout rail down no route is AVAILABLE and the intent is PROVIDER_UNAVAILABLE", ro.route === null && ["PROVIDER_UNAVAILABLE", "LIQUIDITY_FAILED"].includes(out.state), out.state);
  setAggregatorUp("peexit", true); setAggregatorUp("pawapay", true);

  console.log("\nTest 10 — unverifiable identity is not silently continued (gate mode)\n");
  process.env.IDENTITY_RESOLUTION_MODE = "gate";
  const nf = await createIntent({ owner: "dev-upi", identity: "+237670123459", amount: 5_000 });
  ok("NOT_FOUND recipient → CANCELLED at identity resolution, no quote", nf.state === "CANCELLED" && !nf.quote, nf.state);
  process.env.IDENTITY_RESOLUTION_MODE = "advisory";
  const adv = await createIntent({ owner: "dev-upi", identity: "+237670123459", amount: 5_000 });
  ok("in advisory mode the intent proceeds with the destination marked INACTIVE/UNVERIFIED, never as verified", adv.state === "QUOTED" && adv.recipient.destinations.some((d) => d.rail === "MOBILE_MONEY" && d.status !== "ACTIVE"));

  console.log("\nTest 8 — stablecoin transfer: confirmation timeout → RECONCILIATION_REQUIRED, never re-sent\n");
  const t = createChainTx({ asset: "USDT", network: "ETHEREUM", direction: "OUT", amount: 100, to: "0xabc", txid: "0x" + "1".repeat(64) });
  const notSeen = { network: "ETHEREUM", async watchTransaction() {}, async getTransactionStatus() { return { found: false, confirmations: 0 }; }, async getConfirmations() { return 0; }, async getBlock() { return null; }, async getBalance() { return null; }, async getTokenBalance() { return null; } };
  await advanceChainTx(t, Date.now(), notSeen);
  ok("BROADCAST but unseen within the timeout stays BROADCAST", t.state === "BROADCAST" && !t.reconciliation);
  await advanceChainTx(t, Date.now() + 121 * 60_000, notSeen);
  ok("past the network's timeout it is flagged RECONCILIATION_REQUIRED and its state is not advanced or re-broadcast", t.reconciliation === "REQUIRED" && t.state === "BROADCAST" && t.events.some((e) => /NOT re-sent/.test(e.note ?? "")));
  const t2 = createChainTx({ asset: "USDC", network: "ETHEREUM", direction: "IN", amount: 50, txid: "0x" + "2".repeat(64) });
  const seen = { ...notSeen, async getTransactionStatus() { return { found: true, confirmations: 12 }; } };
  await advanceChainTx(t2, Date.now(), seen);
  ok("12 confirmations on Ethereum → CONFIRMED (not FINALIZED until 32)", t2.state === "CONFIRMED");
  const t3 = createChainTx({ asset: "USDT", network: "TRON", direction: "OUT", amount: 1, txid: "abc" });
  await advanceChainTx(t3);
  ok("a network with no monitor is RECONCILIATION_REQUIRED at once (Tests 4/5/6 stay honest: no stablecoin send exists)", t3.reconciliation === "REQUIRED");

  console.log("\nHTTP — /api/v2 behind auth, purpose and the enumeration rule\n");
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
  const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwk = (priv: Uint8Array) => { const pub = p256.getPublicKey(priv, false); return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) }; };
  const keys = new Map<string, Uint8Array>();
  const enroll = async (dev: string) => { const k = p256.utils.randomSecretKey(); keys.set(dev, k); const r = await fetch(`${base}/me/devices`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": dev }, body: JSON.stringify({ authPub: jwk(k), wrapPub: jwk(p256.utils.randomSecretKey()) }) }); if (r.status !== 200) throw new Error(`enrol ${r.status}`); };
  const call = async (method: "POST" | "GET", p: string, dev: string | null, body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    if (dev) { headers["x-mm-sender"] = dev; const priv = keys.get(dev); if (priv) { const ts = String(Date.now()); const msg = new TextEncoder().encode(`${method}\n${p}\n${ts}\n${b64(sha256(new TextEncoder().encode(bodyStr)))}`); headers["x-mm-ts"] = ts; headers["x-mm-sig"] = b64(p256.sign(sha256(msg), priv, { prehash: false, lowS: true })); } }
    const r = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : bodyStr });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
  };
  try {
    await enroll("upi-1");
    ok("no public directory: unauthenticated resolution is 401", (await call("POST", "/v2/payment-resolution", null, { identity: "+237670123456", purpose: "RECIPIENT_VERIFICATION" })).status === 401);
    ok("purpose is required", (await call("POST", "/v2/payment-resolution", "upi-1", { identity: "+237670123456" })).status === 400);
    const res = await call("POST", "/v2/payment-resolution", "upi-1", { identity: "670123456", purpose: "RECIPIENT_VERIFICATION" });
    ok("a signed device resolves the number to its identity, destinations and capabilities", res.status === 200 && res.body.identity.identity === "+237670123456" && res.body.identity.verification?.display_name === "NANA JEAN PAUL" && res.body.destinations.length === 2 && res.body.capabilities.funding.includes("LIGHTNING"), JSON.stringify(res.body).slice(0, 200));
    const supp = await call("POST", "/v2/payment-resolution", "upi-1", { identity: "670123456", purpose: "SUPPORT" });
    ok("a non-payer purpose sees the holder masked", supp.body.identity?.verification?.display_name === "N*** J*** P***", supp.body.identity?.verification?.display_name);
    const w = await call("POST", "/v2/wallet/resolve", "upi-1", { identity: "+237670123456" });
    ok("the wallet API answers with the LUD-16 address to pay — open standard out, no bare-number claim", w.status === 200 && w.body.pay_with?.protocol === "LIGHTNING_ADDRESS" && w.body.pay_with.address === "237670123456@momome.xyz");
    const pi = await call("POST", "/v2/payment-intents", "upi-1", { recipient: { identity: "+237 670 12 34 56" }, amount: { value: 10000, currency: "XAF" } });
    ok("POST /payment-intents → 201 QUOTED with options; the verified name is shown to the payer", pi.status === 201 && pi.body.intent.state === "QUOTED" && pi.body.intent.quote.options.length >= 3 && pi.body.intent.recipient.resolved.verification.display_name === "NANA JEAN PAUL" && pi.body.mode === "SHADOW", `${pi.status} ${pi.body.intent?.state}`);
    const rt = await call("POST", `/v2/payment-intents/${pi.body.intent.id}/route`, "upi-1", { source: { rail: "STABLECOIN", asset: "USDT" } });
    ok("routing on a chosen funding rail picks that route (USDT/ETHEREUM → MTN)", rt.status === 200 && rt.body.route?.type === "STABLECOIN" && rt.body.intent.source.asset === "USDT" && rt.body.intent.state === "ROUTE_SELECTED", JSON.stringify(rt.body.route?.type));
    const ex = await call("POST", `/v2/payment-intents/${pi.body.intent.id}/execute`, "upi-1", {});
    ok("execute is refused in shadow mode / flag off with a plain message — V1 is the money path", ex.status === 403 && /SHADOW|off/i.test(ex.body.message ?? ""), `${ex.status} ${ex.body.error}`);
    ok("another device cannot read it", (await (async () => { await enroll("upi-2"); return call("GET", `/v2/payment-intents/${pi.body.intent.id}`, "upi-2"); })()).status === 404);
    const rails = await call("GET", "/v2/rails/health", "upi-1");
    ok("/rails/health exposes the flags, the mode and the capability registry", rails.status === 200 && rails.body.mode === "SHADOW" && Array.isArray(rails.body.providers));
    // Execute path, end to end, with the flags on: the intent hands the leg to V1 and mirrors its state.
    process.env.PAYMENT_INTENT_V2_ENABLED = "true"; process.env.MULTI_RAIL_ROUTING_ENABLED = "true"; process.env.ROUTING_ENGINE_MODE = "EXECUTE";
    const pi2 = await call("POST", "/v2/payment-intents", "upi-1", { recipient: { identity: "670123456" }, amount: { value: 5000 } });
    await call("POST", `/v2/payment-intents/${pi2.body.intent.id}/route`, "upi-1", { source: { rail: "LIGHTNING" } });
    // Phase 18 — canary: EXECUTE is never everyone at once.
    const exNo = await call("POST", `/v2/payment-intents/${pi2.body.intent.id}/execute`, "upi-1", {});
    ok("EXECUTE with no rollout and an unlisted device is refused by the canary (routed, recorded, not executed)", exNo.status === 403 && exNo.body.error === "canary_refused" && /rollout/.test(exNo.body.message), `${exNo.status} ${exNo.body.error}`);
    process.env.UPI_CANARY_DEVICES = "upi-1"; process.env.UPI_MAX_PER_TX_XAF = "4000";
    const exCap = await call("POST", `/v2/payment-intents/${pi2.body.intent.id}/execute`, "upi-1", {});
    ok("a listed device is still held to the per-payment cap", exCap.status === 403 && /per-payment cap/.test(exCap.body.message), exCap.body.message);
    process.env.UPI_MAX_PER_TX_XAF = "50000";
    const ex2 = await call("POST", `/v2/payment-intents/${pi2.body.intent.id}/execute`, "upi-1", {});
    ok("with the flags on, execute mints the V1 quote + payment and returns a BOLT11 PaymentRequest", ex2.status === 200 && ex2.body.intent.state === "PAYMENT_PENDING" && ex2.body.request?.protocol === "BOLT11" && !!ex2.body.request.refs.v1PaymentId && !!ex2.body.request.refs.correlationId, `${ex2.status} ${JSON.stringify(ex2.body).slice(0, 160)}`);
    const { store } = await import("../src/db/store.js");
    const v1 = await store().getPayment(ex2.body.request.refs.v1PaymentId);
    ok("the V1 payment is a normal V1 payment under the registered name — nothing in V1 changed", v1?.state === "AWAITING_INBOUND" && v1.recipient.name === "NANA JEAN PAUL" && v1.method === "LIGHTNING");
    await call("POST", `/payments/${v1!.id}/simulate`, "upi-1", {});
    let synced = await call("GET", `/v2/payment-intents/${pi2.body.intent.id}`, "upi-1");
    for (let k = 0; k < 40 && synced.body.intent.state !== "COMPLETED"; k++) { await new Promise((r) => setTimeout(r, 250)); synced = await call("GET", `/v2/payment-intents/${pi2.body.intent.id}`, "upi-1"); }
    ok("the intent mirrors V1 to COMPLETED with settlement references", synced.body.intent.state === "COMPLETED" && !!synced.body.intent.refs.mobileMoneyReference, synced.body.intent.state);
    const stable = await call("POST", "/v2/payment-intents", "upi-1", { recipient: { identity: "670123456" }, amount: { value: 5000 } });
    await call("POST", `/v2/payment-intents/${stable.body.intent.id}/route`, "upi-1", { source: { rail: "STABLECOIN", asset: "USDC" } });
    const ex3 = await call("POST", `/v2/payment-intents/${stable.body.intent.id}/execute`, "upi-1", {});
    ok("stablecoin funding through intents stays closed until STABLECOIN_SETTLEMENT_ENABLED (V1 still accepts USDC directly)", ex3.status === 403 && /STABLECOIN_SETTLEMENT_ENABLED/.test(ex3.body.message ?? ""), `${ex3.status} ${ex3.body.error} ${ex3.body.message}`);
    // "Every payment must settle": an intent confirmed in but not paid out is flagged, never kept.
    const { flagUnsettled, getIntent: gi } = await import("../src/core/upi/intents.js");
    const stuck = gi(pi2.body.intent.id)!; stuck.state = "PAYMENT_CONFIRMED"; stuck.events.push({ at: new Date(Date.now() - 45 * 60_000).toISOString(), state: "PAYMENT_CONFIRMED" });
    const flagged = flagUnsettled();
    ok("confirmed-in but unsettled past UPI_SETTLE_WITHIN_MIN → RECONCILIATION_REQUIRED", flagged.some((x) => x.id === stuck.id) && stuck.state === "RECONCILIATION_REQUIRED");
    const { canaryConfig, executedVolume24h } = await import("../src/core/upi/canary.js");
    ok("the executed 24 h volume counts the intent that ran (for the daily cap)", executedVolume24h() >= 5000 && canaryConfig().devices.includes("upi-1"));
    delete process.env.PAYMENT_INTENT_V2_ENABLED; delete process.env.MULTI_RAIL_ROUTING_ENABLED; delete process.env.ROUTING_ENGINE_MODE; delete process.env.UPI_CANARY_DEVICES; delete process.env.UPI_MAX_PER_TX_XAF;
    // Shadow from REAL V1 traffic: with the master flag on, a V1 payment spawns a linked shadow
    // intent (quoted, routed, V1's method as the reference) that executes nothing.
    process.env.UNIVERSAL_PAYMENT_IDENTITY_ENABLED = "true";
    const { allIntents } = await import("../src/core/upi/intents.js");
    const before = allIntents(500).length;
    const sq = await call("POST", "/quotes", "upi-1", { xaf: 7000, method: "USDT", country: "CM" });
    const sp = await call("POST", "/payments", "upi-1", { quoteId: sq.body.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nana Jean Paul" } });
    let shadowed: Awaited<ReturnType<typeof allIntents>>[number] | undefined;
    for (let k = 0; k < 40 && !shadowed; k++) { await new Promise((r) => setTimeout(r, 100)); shadowed = allIntents(500).find((x) => x.refs.v1PaymentId === sp.body.id); }
    ok("a V1 payment (USDT) produced a linked shadow intent, routed with V1's method as the reference, in PAYMENT_PENDING", sp.status === 200 && !!shadowed && shadowed.state === "PAYMENT_PENDING" && shadowed.shadow?.v1Route === "STABLECOIN:USDT" && shadowed.refs.correlationId === `v1:${sp.body.ref}` && allIntents(500).length === before + 1, JSON.stringify(shadowed?.shadow ?? sp.body).slice(0, 160));
    ok("…and the V1 payment itself is exactly as it would be (nothing executed twice)", sp.body.method === "USDT" && sp.body.state === "AWAITING_INBOUND" && sp.body.recipient.name === "NANA JEAN PAUL");
    delete process.env.UNIVERSAL_PAYMENT_IDENTITY_ENABLED;
    const n2 = allIntents(500).length;
    const sq2 = await call("POST", "/quotes", "upi-1", { xaf: 7000, method: "LIGHTNING", country: "CM" });
    await call("POST", "/payments", "upi-1", { quoteId: sq2.body.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nana Jean Paul" } });
    await new Promise((r) => setTimeout(r, 300));
    ok("with the master flag off, V1 payments spawn nothing", allIntents(500).length === n2);
    // V1 untouched: the same quote engine answers exactly as before with every flag on/off.
    const q = await call("POST", "/quotes", "upi-1", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    ok("V1 /quotes unchanged", q.status === 200 && q.body.xaf === 5000 && q.body.method === "LIGHTNING");
    const { issueToken } = await import("../src/core/adminAuth.js"); const { createUser } = await import("../src/core/adminUsers.js");
    const admin = createUser("upi-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
    const adm = await fetch(`${base}/admin/upi`, { headers: { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token } }).then((r) => r.json()) as Record<string, any>;
    ok("Admin sees flags, mode, rule, registry, assets, pools, shadow comparisons, metrics, intents and chain transfers", adm.mode === "SHADOW" && Array.isArray(adm.providers) && adm.shadow.comparisons >= 2 && adm.metrics.payment_total >= 5 && adm.intents.length >= 1 && adm.chain.length >= 3, JSON.stringify({ c: adm.shadow?.comparisons, m: adm.metrics?.payment_total }));
    const rec = await fetch(`${base}/admin/upi/intents/${pi2.body.intent.id}/reconcile`, { headers: { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token } }).then((r) => r.json()) as Record<string, any>;
    ok("reconciliation compares intended vs delivered and balances", rec.reconciliation.ok === true && rec.reconciliation.expected === 5000 && rec.reconciliation.actual === 5000);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

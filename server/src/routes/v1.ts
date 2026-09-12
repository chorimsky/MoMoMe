/* ============================================================
   /api/v1 — the interoperability API.

   Payment Intent → Routing → Settlement → Confirmation, spoken rail-neutrally. Every
   money rule still runs in ONE place: routes quote through buildQuote() and execute
   through createPaymentCore() — the same functions /api/quotes and /api/payments use — so
   this surface cannot disagree with the app. /api/* is untouched and remains supported.

     GET  /rails                              what networks this deployment connects
     GET  /providers                          who operates each, health, liquidity
     POST /payment-addresses/resolve          where can this address receive value?
     POST /payment-intents  (Idempotency-Key) what the user wants to do
     GET  /payment-intents/:id                the intent, status derived from its payment
     POST /payment-intents/:id/routes         discover + rank routes (deterministic)
     POST /payment-intents/:id/execute        lock a route and create the payment
     GET  /payments/:id/status                canonical status + trace ids
     GET  /webhooks/events   (admin)          normalised provider event log
     GET  /reconciliation    (admin)          our records vs the provider's
   ============================================================ */
import { Router, type Request } from "express";
import type { Method, Payment } from "../../../shared/types.js";
import { toCanonicalStatus, type PaymentIntent } from "../../../shared/interop.js";
import { COUNTRIES, PROVIDERS, localDigits } from "../../../shared/domain.js";
import { rateLimitDurableMiddleware } from "../core/ratelimit.js";
import { store } from "../db/store.js";
import { listRails, listProviders } from "../core/interop/rails.js";
import { resolveAddress } from "../core/interop/addresses.js";
import { newIntent, getIntent, saveIntent, intentsOf, getRoute, routesOf, saveRoute, idemLookup, idemStore, validIdemKey, idemFingerprint, IDEM_MISMATCH, intentOfPayment } from "../core/interop/intents.js";
import { discoverRoutes } from "../core/interop/router.js";
import { listEvents, eventStats } from "../core/interop/events.js";
import { reconciliationReport } from "../core/interop/reconcile.js";
import { observability } from "../core/interop/metrics.js";
import { subscribe, listSubscriptions, removeSubscription, outboundStats, subscriptionCount } from "../core/interop/outbound.js";
import { liveMoney } from "../config.js";
import { cancelPayment } from "../core/stateMachine.js";
import { buildQuote, createPaymentCore, ownerOf, mayViewPayment, isAdminRequest, type ReqLike } from "./api.js";

export const v1 = Router();

/** Clients sign the path RELATIVE TO /api ("/v1/payment-intents"); inside this router
 *  req.url is "/payment-intents". Present the signed form to the verifier. */
const asReq = (req: Request): ReqLike => ({
  headers: req.headers as ReqLike["headers"], method: req.method,
  url: (req.originalUrl ?? req.url).replace(/^\/api(?=\/)/, ""),
  rawBody: (req as unknown as { rawBody?: Buffer }).rawBody,
});
const hdr = (req: Request, n: string): string | undefined => { const v = req.headers[n]; const s = Array.isArray(v) ? v[0] : v; return typeof s === "string" && s ? s : undefined; };

/** Status is DERIVED from the executing payment — the intent never carries its own truth. */
async function withLiveStatus(it: PaymentIntent): Promise<PaymentIntent & { payment?: { state: string; ref: string; deliveredAt?: string } }> {
  if (!it.paymentId) return it;
  const p = await store().getPayment(it.paymentId);
  if (!p) return it;
  const status = toCanonicalStatus(p.state, p.payInstruction?.expiresAt, Date.now(), [...p.events].reverse().find((e) => e.note)?.note);
  const complianceStatus = p.state === "MANUAL_REVIEW" ? "review" : it.complianceStatus === "unknown" ? "clear" : it.complianceStatus;
  if (status !== it.status || complianceStatus !== it.complianceStatus) { it.status = status; it.complianceStatus = complianceStatus; saveIntent(it); }
  const delivered = p.events.find((e) => e.state === "DELIVERED")?.at;
  return { ...it, payment: { state: p.state, ref: p.ref, ...(delivered ? { deliveredAt: delivered } : {}) } };
}

/* ---------- discovery ---------- */
v1.get("/rails", async (_req, res) => { res.json({ rails: await listRails() }); });
v1.get("/providers", async (_req, res) => { res.json({ providers: await listProviders() }); });

/* ---------- countries: the core is country-agnostic; this is what each one has today ---------- */
v1.get("/countries", async (_req, res) => {
  const providers = await listProviders();
  res.json({ countries: Object.values(COUNTRIES).map((c) => {
    const operators = c.providers.map((op) => {
      const payout = providers.filter((p) => p.rail === "mobile_money" && p.reaches.includes(op) && p.countries.includes(c.code));
      const real = payout.some((p) => p.health === "OPERATIONAL" || p.health === "DEGRADED" || p.health === "SANDBOX");
      // A sandbox deployment settles through the simulator, exactly as the router and the
      // resolver say; `simulated` keeps that honest in the same breath.
      return { id: op, name: PROVIDERS[op]?.name ?? op, payoutProviders: payout.map((p) => ({ id: p.id, health: p.health })), reachable: real || (!liveMoney() && c.active), ...(real || !c.active ? {} : { simulated: true }) };
    });
    return {
      code: c.code, name: c.name, currency: c.ccy, dial: c.dial, active: c.active, numberLengths: c.nsnLen,
      operators,
      // What activation needs beyond flipping `active`: a payout provider that reaches at
      // least one operator in this country, and the numbering plan confirmed.
      readiness: { payoutRail: operators.some((o) => o.reachable && !("simulated" in o)), numberingPlanConfirmed: c.nsnLen.length === 1 },
    };
  }) });
});

/* ---------- payment addresses ---------- */
v1.post("/payment-addresses/resolve", rateLimitDurableMiddleware("v1_resolve", 60, 60_000), async (req, res) => {
  const { address, country } = (req.body ?? {}) as { address?: unknown; country?: unknown };
  if (typeof address !== "string" || address.length > 200) return res.status(400).json({ error: "bad_address", message: "Send { address: string }." });
  const cc = typeof country === "string" && COUNTRIES[country as keyof typeof COUNTRIES] ? (country as keyof typeof COUNTRIES) : undefined;
  const a = await resolveAddress(address, cc);
  if (!a) return res.status(404).json({ error: "unresolvable", message: "That is not a payment address we recognise (phone number, Lightning Address, merchant code or payment link)." });
  res.json(a);
});

/* ---------- payment intents ---------- */
v1.post("/payment-intents", rateLimitDurableMiddleware("v1_intent", 30, 60_000), async (req, res) => {
  const owner = await ownerOf(asReq(req));
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device or API key." });
  const key = hdr(req, "idempotency-key");
  if (key !== undefined && !validIdemKey(key)) return res.status(400).json({ error: "bad_idempotency_key", message: "Idempotency-Key must be 8–128 printable characters." });
  const fp = idemFingerprint(req.body);
  if (key) { const prior = idemLookup(owner, `intent:${key}`, fp); if (prior?.mismatch) return res.status(422).json(IDEM_MISMATCH); if (prior) return res.status(prior.status).json(prior.body); }

  const b = (req.body ?? {}) as { destination?: unknown; amount?: unknown; currency?: unknown; purpose?: unknown; preferredMethod?: unknown; country?: unknown };
  const reply = async (status: number, body: unknown) => { if (key) idemStore(owner, `intent:${key}`, status, body, fp); return res.status(status).json(body); };
  if (typeof b.destination !== "string") return reply(400, { error: "bad_destination", message: "destination must be a payment address string." });
  if (typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount <= 0) return reply(400, { error: "bad_amount", message: "amount must be a positive number in the destination currency." });
  const cc = typeof b.country === "string" && COUNTRIES[b.country as keyof typeof COUNTRIES] ? (b.country as keyof typeof COUNTRIES) : undefined;
  const dest = await resolveAddress(b.destination, cc);
  if (!dest) return reply(404, { error: "unresolvable", message: "Destination is not a payment address we recognise." });
  if (typeof b.currency === "string" && dest.currency && b.currency.toUpperCase() !== dest.currency) return reply(400, { error: "unsupported_currency", message: `This destination receives ${dest.currency}.` });
  const pm = typeof b.preferredMethod === "string" && ["LIGHTNING", "ONCHAIN", "USDT", "USDC"].includes(b.preferredMethod) ? (b.preferredMethod as Method) : undefined;
  const it = newIntent({
    owner, destination: dest, amount: Math.round(b.amount), destinationCurrency: dest.currency ?? "XAF",
    purpose: typeof b.purpose === "string" ? b.purpose.slice(0, 140) : undefined, preferredMethod: pm, idempotencyKey: key,
  });
  it.status = dest.status === "ACTIVE" ? "VALIDATING" : "FAILED";
  if (dest.status !== "ACTIVE") { it.riskStatus = dest.status === "BLOCKED" ? "blocked" : "unknown"; saveIntent(it); return reply(422, { error: "destination_unavailable", message: `This destination is ${dest.status.toLowerCase()}.`, intent: it }); }
  saveIntent(it);
  return reply(201, it);
});

v1.get("/payment-intents", async (req, res) => {
  const owner = await ownerOf(asReq(req));
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device or API key." });
  res.json({ intents: await Promise.all(intentsOf(owner).slice(0, 50).map(withLiveStatus)) });
});

v1.get("/payment-intents/:id", async (req, res) => {
  const it = getIntent(req.params.id);
  const owner = await ownerOf(asReq(req));
  if (!it || (it.owner !== owner && !isAdminRequest(asReq(req)))) return res.status(404).json({ error: "not_found", message: "Not found." });
  res.json({ ...(await withLiveStatus(it)), routes: routesOf(it.id) });
});

/* ---------- routing ---------- */
v1.post("/payment-intents/:id/routes", rateLimitDurableMiddleware("v1_routes", 60, 60_000), async (req, res) => {
  const it = getIntent(req.params.id);
  const owner = await ownerOf(asReq(req));
  if (!it || it.owner !== owner) return res.status(404).json({ error: "not_found", message: "Not found." });
  if (it.paymentId) return res.status(409).json({ error: "already_executing", message: "This intent already has a payment." });
  it.status = "ROUTING"; saveIntent(it);
  // Re-resolve: availability and names can change between creation and routing.
  const dest = (await resolveAddress(it.destination.value, it.destination.country ?? undefined)) ?? it.destination;
  const routes = await discoverRoutes(it, dest, buildQuote);
  const viable = routes.filter((r) => r.viable);
  it.destination = dest; it.availableRoutes = viable.map((r) => r.id); it.status = viable.length ? "QUOTED" : "FAILED"; saveIntent(it);
  res.json({ intent: it, routes, recommended: viable[0]?.id ?? null });
});

/* ---------- execution ---------- */
v1.post("/payment-intents/:id/execute", rateLimitDurableMiddleware("v1_execute", 30, 60_000), async (req, res) => {
  const it = getIntent(req.params.id);
  const owner = await ownerOf(asReq(req));
  if (!it || it.owner !== owner) return res.status(404).json({ error: "not_found", message: "Not found." });
  const key = hdr(req, "idempotency-key");
  if (key !== undefined && !validIdemKey(key)) return res.status(400).json({ error: "bad_idempotency_key", message: "Idempotency-Key must be 8–128 printable characters." });
  const fp = idemFingerprint(req.body);
  if (key) { const prior = idemLookup(owner, `execute:${it.id}:${key}`, fp); if (prior?.mismatch) return res.status(422).json(IDEM_MISMATCH); if (prior) return res.status(prior.status).json(prior.body); }
  const reply = (status: number, body: unknown) => { if (key) idemStore(owner, `execute:${it.id}:${key}`, status, body, fp); return res.status(status).json(body); };
  // Executing twice is the classic double-payment; the intent itself is the lock.
  if (it.paymentId) return reply(200, { intent: await withLiveStatus(it), route: it.routeId ? getRoute(it.routeId) : null, payment: await store().getPayment(it.paymentId) });

  const { routeId, riskToken, recipientName } = (req.body ?? {}) as { routeId?: unknown; riskToken?: unknown; recipientName?: unknown };
  const route = typeof routeId === "string" ? getRoute(routeId) : routesOf(it.id).filter((r) => r.viable).sort((a, b) => b.score.total - a.score.total)[0];
  if (!route || route.intentId !== it.id) return reply(404, { error: "no_route", message: "Route not found for this intent — discover routes first." });
  if (!route.viable || !route.quote.quoteId) return reply(409, { error: "route_not_viable", message: "This route is not viable. Discover routes again." });
  if (Date.parse(route.quote.expiresAt) < Date.now()) { route.status = "EXPIRED"; saveRoute(route); return reply(409, { error: "quote_expired", message: "The quote on this route expired — discover routes again." }); }

  route.status = "LOCKED"; saveRoute(route);
  it.routeId = route.id; it.sourceCurrency = route.sourceCurrency; it.status = "AUTHORIZED"; saveIntent(it);
  const dest = it.destination;
  const mm = dest.rails.find((r) => r.rail === "mobile_money");
  const local = dest.country ? localDigits(dest.value, dest.country) : dest.value;

  const body = {
    quoteId: route.quote.quoteId,
    recipient: { phone: local, country: dest.country ?? "CM", provider: mm?.provider ?? "MTN", name: typeof recipientName === "string" ? recipientName : (dest.owner.displayName ?? "") },
    ...(typeof riskToken === "string" ? { riskToken } : {}),
    ...(dest.type === "MERCHANT_CODE" ? { merchantCode: dest.value } : {}),
  };
  // createPaymentCore verifies the device signature against req.url; give it the signed form.
  const signedReq = new Proxy(req, { get: (t, k) => (k === "url" ? (t.originalUrl ?? t.url).replace(/^\/api(?=\/)/, "") : Reflect.get(t, k)) });
  const r = await createPaymentCore(signedReq, body);
  if (r.status !== 200) {
    route.status = "PROPOSED"; saveRoute(route);
    it.routeId = null; it.status = "QUOTED"; saveIntent(it);
    return reply(r.status, r.body);
  }
  const p = r.body as Payment;
  route.status = "EXECUTING"; saveRoute(route);
  it.paymentId = p.id; it.paymentRef = p.ref; it.status = toCanonicalStatus(p.state, p.payInstruction?.expiresAt); saveIntent(it);
  return reply(201, { intent: it, route, payment: p });
});

/* ---------- cancellation: before the pay-in, nothing has moved ---------- */
v1.post("/payment-intents/:id/cancel", async (req, res) => {
  const it = getIntent(req.params.id);
  const owner = await ownerOf(asReq(req));
  if (!it || it.owner !== owner) return res.status(404).json({ error: "not_found", message: "Not found." });
  if (it.paymentId) {
    const p = await store().getPayment(it.paymentId);
    if (!p) return res.status(404).json({ error: "not_found", message: "Not found." });
    const r = await cancelPayment(p, "sender");
    if (!r.ok) return res.status(409).json({ error: r.reason, message: r.reason === "already_paid" ? "This payment has already been paid — it cannot be cancelled. Wait for delivery or a refund." : "This payment is already closed." });
  }
  if (it.routeId) { const rt = getRoute(it.routeId); if (rt) { rt.status = "EXPIRED"; saveRoute(rt); } }
  it.status = "CANCELLED"; saveIntent(it);
  res.json(await withLiveStatus(it));
});

/* ---------- payments: canonical status with the trace chain ---------- */
v1.get("/payments/:id/status", async (req, res) => {
  const p = await store().getPayment(req.params.id) ?? await store().findPaymentByRef(req.params.id);
  if (!p || !(await mayViewPayment(asReq(req), p.senderId))) return res.status(404).json({ error: "not_found", message: "Not found." });
  res.json({
    paymentId: p.id, ref: p.ref, status: toCanonicalStatus(p.state, p.payInstruction?.expiresAt, Date.now(), [...p.events].reverse().find((e) => e.note)?.note), engineState: p.state,
    amount: p.xaf, currency: "XAF", fee: p.feeXaf, method: p.method,
    trace: { paymentId: p.id, ref: p.ref, intentId: intentOfPayment(p.id)?.id ?? null, routeId: intentOfPayment(p.id)?.routeId ?? null, providerReference: p.payInstruction?.providerRef ?? null, provider: p.payInstruction?.provider ?? null, payoutProvider: p.aggregator ?? null, payoutReference: p.payoutRef ?? null },
    timeline: p.events.map((e) => ({ at: e.at, status: toCanonicalStatus(e.state, undefined, Date.now(), e.note), engineState: e.state, note: e.note })),
    ...(p.complianceFlags?.length ? { complianceFlags: p.complianceFlags } : {}),
    updatedAt: p.updatedAt,
  });
});

/* ---------- partner webhooks: we call you ---------- */
v1.post("/webhooks/subscriptions", rateLimitDurableMiddleware("v1_sub", 10, 60_000), async (req, res) => {
  const owner = await ownerOf(asReq(req));
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device or API key." });
  const { url, events } = (req.body ?? {}) as { url?: unknown; events?: unknown };
  if (typeof url !== "string" || url.length > 500) return res.status(400).json({ error: "bad_url", message: "Send { url: \"https://…\" }." });
  const evs = Array.isArray(events) ? events.filter((e): e is string => typeof e === "string").slice(0, 10) : ["payment.status"];
  const r = subscribe(owner, url, evs, !liveMoney());
  if (!r.ok) return res.status(400).json({ error: "bad_subscription", message: r.reason });
  // The secret is shown ONCE; we keep only what we need to sign.
  res.status(201).json({ subscription: r.sub, secret: r.secret, signing: "X-MoMoMe-Signature: t=<ms>,v1=hex(hmac_sha256(secret, `${t}.${rawBody}`))" });
});
v1.get("/webhooks/subscriptions", async (req, res) => {
  const owner = await ownerOf(asReq(req));
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device or API key." });
  res.json({ subscriptions: listSubscriptions(owner), deliveries: outboundStats(owner) });
});
v1.delete("/webhooks/subscriptions/:id", async (req, res) => {
  const owner = await ownerOf(asReq(req));
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device or API key." });
  res.json({ ok: removeSubscription(owner, req.params.id) });
});

/* ---------- operations (admin) ---------- */
v1.get("/webhooks/events", async (req, res) => {
  if (!isAdminRequest(asReq(req))) return res.status(403).json({ error: "admin_only", message: "This endpoint is for the operator console." });
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  res.json({ stats: eventStats(), events: listEvents(200, provider) });
});
v1.get("/observability", async (req, res) => {
  if (!isAdminRequest(asReq(req))) return res.status(403).json({ error: "admin_only", message: "This endpoint is for the operator console." });
  const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
  res.json({ ...(await observability(hours)), outbound: { subscriptions: subscriptionCount(), ...outboundStats() } });
});
v1.get("/reconciliation", async (req, res) => {
  if (!isAdminRequest(asReq(req))) return res.status(403).json({ error: "admin_only", message: "This endpoint is for the operator console." });
  res.json(await reconciliationReport());
});

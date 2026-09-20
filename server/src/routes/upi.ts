/* ============================================================
   /api/v2 — Universal Payment Identity surface (docs/upi/PAYMENT_IDENTITY_API.md).
     POST /payment-resolution     who is being paid, where value can reach them
     POST /payment-intents        create → identity → quote (every funding option)
     GET  /payment-intents/:id    the intent, re-synced with the engine that holds the money
     POST /payment-intents/:id/route    deterministic route (recorded in shadow)
     POST /payment-intents/:id/execute  hand the leg to V1 (flags + EXECUTE mode only)
     POST /payment-intents/:id/cancel
     GET  /assets · GET /rails/health · POST /wallet/resolve (wallet-facing, LUD-16 out)
   Same actor model as /v2/identity: signed device, partner key or admin; purpose-bound;
   rate-limited; 404 unless UNIVERSAL_PAYMENT_IDENTITY_ENABLED (sandbox always reachable).
   ============================================================ */
import { Router, type Request, type Response } from "express";
import { actorOf } from "./identityV2.js";
import { upiReachable, flag, flags, routingMode } from "../core/upi/flags.js";
import * as ident from "../core/upi/identity.js";
import { assets, NETWORKS } from "../core/upi/assets.js";
import { capabilityRegistry } from "../core/upi/capabilities.js";
import { createIntent, getIntent, intentsOf, selectRouteFor, executeIntent, syncIntent, cancelIntent, IntentError } from "../core/upi/intents.js";
import { rateLimitDurable, rateLimitDurableMiddleware, clientIp } from "../core/ratelimit.js";
import { identityEnumerationExceeded } from "../core/identityResolution/audit.js";
import { identifierHash } from "../core/identityResolution/msisdn.js";
import { IdentityError, HTTP_FOR_ERROR } from "../core/identityResolution/errors.js";
import { IDENTITY_PURPOSES, type IdentityPurpose } from "../../../shared/identity.js";
import { maskName } from "../../../shared/domain.js";
import type { PaymentIdentity } from "../../../shared/upi.js";
import { buildQuote, createPaymentCore } from "./api.js";
import { feePctForOwner } from "../core/apiKeys.js";

export const upi = Router();
upi.use((_req, res, next) => { if (upiReachable()) return next(); res.status(404).json({ error: "UPI_DISABLED", message: "Not available." }); });

/** The identity as a third party may see it: verification status and a masked holder name
 *  unless the caller is the payer flow (purpose PAYMENT_CREATION / RECIPIENT_VERIFICATION),
 *  which already sees the full name through /v2/identity. */
function publicIdentity(idn: PaymentIdentity, full: boolean) {
  const v = idn.verification;
  return { type: idn.type, identity: idn.canonical, country: idn.country, currency: idn.currency, operator: idn.operator, native: idn.native, verification: v ? { status: v.status, verified: v.verified, display_name: v.displayName ? (full ? v.displayName : maskName(v.displayName)) : undefined, provider: v.provider } : null };
}
async function guard(req: Request, res: Response, kind: "resolve" | "intent"): Promise<{ id: string; kind: string } | null> {
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "UNAUTHORIZED", message: "Sign in on this device." }); return null; }
  const rl = await rateLimitDurable(`upi:${kind}:${actor.id}`, kind === "resolve" ? 30 : 20, 60_000);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfterSec)); res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Please wait a moment." }); return null; }
  return actor;
}

/* ---- resolution: never a GET with the number in the path, never unauthenticated ---- */
upi.post("/payment-resolution", rateLimitDurableMiddleware("upi_ip", 120, 60_000), async (req, res) => {
  if (!flag("PHONE_PAYMENT_RESOLUTION_ENABLED") && !upiReachable()) return res.status(404).json({ error: "UPI_DISABLED" });
  const actor = await guard(req, res, "resolve"); if (!actor) return;
  const b = (req.body ?? {}) as { identity?: unknown; purpose?: unknown; country?: unknown };
  const purpose = String(b.purpose ?? "") as IdentityPurpose;
  if (!IDENTITY_PURPOSES.includes(purpose)) return res.status(400).json({ error: "PURPOSE_REQUIRED", message: "A purpose is required." });
  const raw = typeof b.identity === "string" ? b.identity : "";
  if (actor.kind !== "admin" && identityEnumerationExceeded(actor.id, clientIp(req), identifierHash(raw.replace(/\D/g, "") || raw.toLowerCase()))) return res.status(429).json({ error: "RATE_LIMITED", message: "Too many different identities resolved. Please try later." });
  try {
    const idn = await ident.resolve(raw, { purpose, actor: actor.id, defaultCountry: typeof b.country === "string" ? b.country : "CM" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, identity: publicIdentity(idn, purpose === "PAYMENT_CREATION" || purpose === "RECIPIENT_VERIFICATION"), destinations: ident.getDestinations(idn), capabilities: ident.getCapabilities(idn) });
  } catch (e) {
    if (e instanceof IdentityError) return res.status(HTTP_FOR_ERROR[e.code] ?? 400).json({ success: false, error: e.code, message: e.message });
    res.status(500).json({ success: false, error: "RESOLUTION_FAILED", message: "Could not resolve this identity right now." });
  }
});

/* ---- wallet-facing: what a wallet needs to pay this identity (open standards out) ---- */
upi.post("/wallet/resolve", rateLimitDurableMiddleware("upi_wallet_ip", 60, 60_000), async (req, res) => {
  if (!flag("WALLET_RESOLUTION_API_ENABLED") && !upiReachable()) return res.status(404).json({ error: "UPI_DISABLED" });
  const actor = await guard(req, res, "resolve"); if (!actor) return;
  const raw = String((req.body ?? {}).identity ?? "");
  if (actor.kind !== "admin" && identityEnumerationExceeded(actor.id, clientIp(req), identifierHash(raw.replace(/\D/g, "") || raw.toLowerCase()))) return res.status(429).json({ error: "RATE_LIMITED" });
  try {
    const idn = await ident.resolve(raw, { purpose: "RECIPIENT_VERIFICATION", actor: actor.id, live: false });
    const d = ident.getDestinations(idn);
    const ln = d.find((x) => x.rail === "LIGHTNING") as { address?: string } | undefined;
    // A wallet that understands a MoMo›Me number gets the LUD-16 address to pay it with —
    // the standard it already speaks. No proprietary invoice format, no bare-number claim.
    res.json({ identity: idn.canonical, type: idn.type, pay_with: ln?.address ? { protocol: "LIGHTNING_ADDRESS", address: ln.address, lnurlp: `/.well-known/lnurlp/${ln.address.split("@")[0]}` } : null, destinations: d.map((x) => ({ ...x })), uma: flag("UMA_COMPATIBILITY_ENABLED") ? { supported: false, note: "UMA messaging not implemented" } : undefined });
  } catch (e) { if (e instanceof IdentityError) return res.status(HTTP_FOR_ERROR[e.code] ?? 400).json({ error: e.code, message: e.message }); res.status(500).json({ error: "RESOLUTION_FAILED" }); }
});

/* ---- intents ---- */
const intentOut = (i: Awaited<ReturnType<typeof createIntent>>, full: boolean) => ({ ...i, recipient: { ...i.recipient, resolved: i.recipient.resolved ? publicIdentity(i.recipient.resolved, full) : undefined } });
upi.post("/payment-intents", rateLimitDurableMiddleware("upi_ip", 120, 60_000), async (req, res) => {
  const actor = await guard(req, res, "intent"); if (!actor) return;
  const b = (req.body ?? {}) as { recipient?: { identity?: unknown }; amount?: { value?: unknown; currency?: unknown }; source?: { rail?: unknown; asset?: unknown; network?: unknown }; country?: unknown };
  const identityStr = typeof b.recipient?.identity === "string" ? b.recipient.identity : "";
  const value = Number(b.amount?.value);
  if (!identityStr || !Number.isFinite(value) || value <= 0) return res.status(400).json({ error: "bad_intent", message: "recipient.identity and amount.value are required." });
  try {
    const i = await createIntent({ owner: actor.id, identity: identityStr, amount: value, currency: typeof b.amount?.currency === "string" ? b.amount.currency : undefined, defaultCountry: typeof b.country === "string" ? b.country : undefined, feePct: feePctForOwner(actor.id), correlationId: String(req.headers["x-correlation-id"] ?? "") || undefined, source: b.source && typeof b.source.rail === "string" ? { rail: b.source.rail, asset: typeof b.source.asset === "string" ? b.source.asset : undefined, network: typeof b.source.network === "string" ? b.source.network : null } : undefined });
    res.status(201).json({ intent: intentOut(i, true), mode: routingMode() });
  } catch (e) {
    if (e instanceof IntentError) return res.status(e.status).json({ error: e.code, message: e.message });
    res.status(500).json({ error: "intent_failed", message: "Could not create the payment intent." });
  }
});
async function ownIntent(req: Request, res: Response) {
  const actor = await guard(req, res, "intent"); if (!actor) return null;
  const i = getIntent(req.params.id);
  if (!i || (i.owner !== actor.id && actor.kind !== "admin")) { res.status(404).json({ error: "not_found" }); return null; }
  return { actor, intent: await syncIntent(i) };
}
upi.get("/payment-intents", async (req, res) => { const actor = await guard(req, res, "intent"); if (!actor) return; res.json({ intents: (await Promise.all(intentsOf(actor.id).map(syncIntent))).map((i) => intentOut(i, true)) }); });
upi.get("/payment-intents/:id", async (req, res) => { const x = await ownIntent(req, res); if (!x) return; res.json({ intent: intentOut(x.intent, true), mode: routingMode() }); });
upi.post("/payment-intents/:id/route", async (req, res) => {
  const x = await ownIntent(req, res); if (!x) return;
  const b = (req.body ?? {}) as { source?: { rail?: unknown; asset?: unknown } };
  try { const r = await selectRouteFor(x.intent, b.source && typeof b.source.rail === "string" ? { rail: b.source.rail, asset: typeof b.source.asset === "string" ? b.source.asset : undefined } : undefined); res.json({ intent: intentOut(x.intent, true), route: r.route, routes: r.routes, mode: routingMode() }); }
  catch (e) { if (e instanceof IntentError) return res.status(e.status).json({ error: e.code, message: e.message }); res.status(500).json({ error: "routing_failed" }); }
});
upi.post("/payment-intents/:id/execute", async (req, res) => {
  const x = await ownIntent(req, res); if (!x) return;
  try {
    const i = await executeIntent(x.intent, async ({ method, xaf, recipient }) => {
      const q = await buildQuote({ xaf, method, country: "CM", feePct: feePctForOwner(x.actor.id) });
      if (q.status !== 200) return { status: q.status, body: q.body as { error?: string; message?: string } };
      // The V1 core verifies the device signature over the path relative to /api; inside this
      // router req.url is mount-relative, so hand it the original path.
      const v1Req = Object.assign(Object.create(req), { url: (req.originalUrl ?? req.url).replace(/^\/api/, "") });
      return createPaymentCore(v1Req, { quoteId: (q.body as { id: string }).id, recipient: { ...recipient, nameSource: recipient.name ? "provider" : "unknown" } }) as never;
    });
    res.json({ intent: intentOut(i, true), request: i.request });
  } catch (e) { if (e instanceof IntentError) return res.status(e.status).json({ error: e.code, message: e.message }); res.status(500).json({ error: "execution_failed", message: (e as Error).message }); }
});
upi.post("/payment-intents/:id/cancel", async (req, res) => { const x = await ownIntent(req, res); if (!x) return; res.json({ ok: cancelIntent(x.intent, "cancelled by the payer"), intent: intentOut(x.intent, true) }); });

/* ---- reference data ---- */
upi.get("/assets", async (req, res) => { if (!(await guard(req, res, "resolve"))) return; res.json({ assets: assets(), networks: Object.values(NETWORKS) }); });
upi.get("/rails/health", async (req, res) => { if (!(await guard(req, res, "resolve"))) return; res.json({ flags: flags(), mode: routingMode(), providers: await capabilityRegistry() }); });

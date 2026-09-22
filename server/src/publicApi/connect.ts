/* ============================================================
   /v1 — MoMo›Me Connect: the institutional API (docs/connect, Phase 8).

   Identities      POST /identities · GET /identities/me · GET /identities/:id · PATCH /identities/:id
                   POST /identities/:id/aliases · GET /identities/:id/balance
   Discovery       POST /resolve                      (privacy-preserving reachability)
   Counterparties  POST /counterparties · GET /counterparties · POST /counterparties/:id/link
   Intents         POST /payment-intents · GET /payment-intents/:id · POST …/execute · POST …/cancel
   Invoices        POST /invoices (kind invoice|payment_link|qr) · GET /invoices · GET /invoices/:id · POST …/cancel
   Request-to-pay  POST /requests
   Payouts         POST /payouts · GET /payouts · GET /payouts/:id
   Checkout (public, no credential) GET /checkout/:intent · POST /checkout/:intent/pay · GET /checkout/:intent/status
   Sandbox         POST /sandbox/identities/:id/credit  (test only: fund a balance)
   Every write is idempotent through the shared pipeline (Idempotency-Key).
   ============================================================ */
import { route, auditCtx, deploymentEnv, type Ctx } from "./index.js";
import { err } from "./errors.js";
import { createMpi, getMpi, findByAlias, addAlias, updateProfiles, mpiForOrganization, mpiForMerchant, mpiForPhone, publicMpi, ownerMpi, normalizeAlias, type AliasType, type MpiType, type PaymentMethodId, type SettlementProfile, type PaymentProfile } from "../core/connect/identities.js";
import { createCounterparty, counterpartiesOf, getCounterparty, linkToMpi, publicCounterparty } from "../core/connect/counterparties.js";
import { createIntent, getIntent, intentsOf, executeIntent, cancelIntent, routeFor, publicIntent, ConnectError, type Surface } from "../core/connect/intents.js";
import { createInvoice, getInvoice, invoicesOf, cancelInvoice, publicInvoice } from "../core/connect/invoices.js";
import { createPayout, getPayout, payoutsOf, publicPayout, PayoutError } from "../core/connect/payouts.js";
import { balanceOf, creditBalance } from "../core/connect/ledger.js";
import { fundingAvailable } from "../core/connect/routing.js";
import { rateLimitDurable } from "../core/ratelimit.js";
import { meter } from "../core/platform/usage.js";
import type { CountryCode } from "../../../shared/types.js";
import { store } from "../db/store.js";
import { settlementIntentsOf, getSettlementIntent, publicSettlementIntent } from "../core/connect/settlements.js";
import { cancelPayment } from "../core/stateMachine.js";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => { const n = Number(str(v)); return Number.isFinite(n) ? n : NaN; };
const METHODS: PaymentMethodId[] = ["momo_me", "mobile_money", "bank_transfer", "lightning", "stablecoin"];
const ALIAS_TYPES: AliasType[] = ["phone", "email", "momome_id", "merchant_code", "lightning_address", "api_recipient_id", "external_id"];
const MPI_TYPES: MpiType[] = ["individual", "business", "merchant", "institution", "mfi", "bank", "fintech", "marketplace", "branch", "application", "government"];
const wrap = <T,>(f: () => T | Promise<T>) => Promise.resolve().then(f).catch((e) => { if (e instanceof ConnectError || e instanceof PayoutError) throw err(e.status, e.code.toLowerCase() as never, e.message, (e as ConnectError).details ?? {}); throw e; });
const mine = (ctx: Ctx) => { const m = mpiForOrganization(ctx.orgId); if (!m) throw err(500, "internal_error", "Could not resolve your payment identity."); return m; };
/** May this organization act on / read this MPI? Its own, or one it created. */
const owned = (ctx: Ctx, id: string) => { const m = getMpi(id); if (!m || m.orgId !== ctx.orgId) throw err(404, "identity_not_found", "No such identity for this organization."); return m; };

/* ---------- identities ---------- */
route("get", "/identities/me", { scope: "identities:read", cls: "identities" }, async (ctx) => ({ ...ownerMpi(mine(ctx)), balance: { available: String(balanceOf(mine(ctx).id)), currency: "XAF" } }));
route("post", "/identities", { scope: "identities:write", idempotent: true, cls: "identities" }, async (ctx) => {
  const b = ctx.body; const type = (str(b.type) || "business") as MpiType;
  if (!MPI_TYPES.includes(type)) throw err(422, "invalid_request", `type must be one of ${MPI_TYPES.join(", ")}.`, { field: "type" });
  if (!str(b.display_name)) throw err(422, "invalid_request", "`display_name` is required.", { field: "display_name" });
  const aliases = Array.isArray(b.aliases) ? (b.aliases as Array<Record<string, unknown>>).map((a) => ({ type: str(a.type) as AliasType, value: str(a.value), verified: false })).filter((a) => ALIAS_TYPES.includes(a.type) && a.value) : [];
  const settlement = (b.settlement ?? {}) as Partial<SettlementProfile>;
  const r = createMpi({ type, displayName: str(b.display_name), country: (str(b.country).toUpperCase() || "CM") as CountryCode, aliases, orgId: ctx.orgId, settlement });
  if (!r.ok) throw err(r.error.startsWith("alias_taken") ? 409 : 422, r.error.startsWith("alias_taken") ? "duplicate_request" : "invalid_identity", r.error.startsWith("alias_taken") ? "One of the aliases already belongs to another identity." : `Invalid identity: ${r.error}.`, { reason: r.error });
  auditCtx(ctx, "identity.created", { type: "identity", id: r.mpi.id });
  ctx.status = 201; return ownerMpi(r.mpi);
});
route("get", "/identities", { scope: "identities:read", cls: "identities" }, async (ctx) => ({ object: "list", data: [mine(ctx), ...((await import("../core/connect/identities.js")).listMpis({ orgId: ctx.orgId }).filter((m) => m.id !== mine(ctx).id))].map(ownerMpi) }));
route("get", "/identities/:id", { scope: "identities:read", cls: "identities" }, async (ctx) => { const m = getMpi(ctx.params.id); if (!m) throw err(404, "identity_not_found", "No such identity."); return m.orgId === ctx.orgId ? ownerMpi(m) : publicMpi(m); });
route("patch", "/identities/:id", { scope: "identities:write", cls: "identities" }, async (ctx) => {
  const m = owned(ctx, ctx.params.id); const b = ctx.body;
  const payment = b.payment_profile && typeof b.payment_profile === "object" ? (({ methods, preferred, currencies, lightningEnabled, stablecoinEnabled, momoBalance }: Partial<PaymentProfile>) => ({ ...(Array.isArray(methods) ? { methods: methods.filter((x) => METHODS.includes(x)) } : {}), ...(Array.isArray(preferred) ? { preferred: preferred.filter((x) => METHODS.includes(x)) } : {}), ...(Array.isArray(currencies) ? { currencies } : {}), ...(typeof lightningEnabled === "boolean" ? { lightningEnabled } : {}), ...(typeof stablecoinEnabled === "boolean" ? { stablecoinEnabled } : {}), ...(typeof momoBalance === "boolean" ? { momoBalance } : {}) }))(b.payment_profile as Partial<PaymentProfile>) : undefined;
  const s = (b.settlement ?? {}) as Record<string, unknown>;
  const settlement: Partial<SettlementProfile> | undefined = b.settlement ? { ...(str(s.preferred) ? { preferred: str(s.preferred) as SettlementProfile["preferred"] } : {}), ...(Array.isArray(s.fallback) ? { fallback: s.fallback as SettlementProfile["fallback"] } : {}), ...(typeof s.allowLightning === "boolean" ? { allowLightning: s.allowLightning } : {}), ...(typeof s.allowStablecoin === "boolean" ? { allowStablecoin: s.allowStablecoin } : {}), ...(str(s.frequency) ? { frequency: str(s.frequency) as SettlementProfile["frequency"] } : {}), ...(s.destination && typeof s.destination === "object" ? { destination: (() => { const d = s.destination as Record<string, unknown>; const out: NonNullable<SettlementProfile["destination"]> = {}; if (str(d.phone)) { const n = normalizeAlias("phone", str(d.phone), m.country); if (!n) throw err(422, "invalid_identity", "settlement.destination.phone is not a valid Mobile Money number."); out.phone = n; out.country = m.country; } if (str(d.lightning_address)) out.lightning_address = str(d.lightning_address).toLowerCase(); if (str(d.bank)) out.bank = str(d.bank); if (str(d.account)) out.account = str(d.account); return out; })() } : {}) } : undefined;
  if (settlement?.preferred && !["momo_me", "mobile_money", "bank_transfer", "lightning", "stablecoin"].includes(settlement.preferred)) throw err(422, "invalid_request", "settlement.preferred is not a known method.");
  if (settlement?.preferred === "stablecoin") throw err(422, "payment_method_unavailable", "Stablecoin settlement is not offered: MoMo›Me holds no stablecoins for customers (pass-through model).");
  const out = updateProfiles(m.id, { payment, settlement, displayName: str(b.display_name) || undefined });
  auditCtx(ctx, "identity.updated", { type: "identity", id: m.id });
  return ownerMpi(out!);
});
route("post", "/identities/:id/aliases", { scope: "identities:write", idempotent: true, cls: "identities" }, async (ctx) => {
  const m = owned(ctx, ctx.params.id); const type = str(ctx.body.type) as AliasType;
  if (!ALIAS_TYPES.includes(type)) throw err(422, "invalid_request", `type must be one of ${ALIAS_TYPES.join(", ")}.`);
  const r = addAlias(m.id, type, str(ctx.body.value), false);
  if (!r.ok) throw err(r.error === "alias_taken" ? 409 : 422, r.error === "alias_taken" ? "duplicate_request" : "invalid_identity", r.error === "alias_taken" ? "That alias belongs to another identity." : "Invalid alias value.");
  (await import("../core/connect/counterparties.js")).relinkCounterparties();
  return ownerMpi(r.mpi);
});
route("get", "/identities/:id/balance", { scope: "balances:read", cls: "identities" }, async (ctx) => { const m = owned(ctx, ctx.params.id); return { identity: m.id, currency: "XAF", available: String(balanceOf(m.id)) }; });

/* ---------- discovery (§33) ---------- */
route("post", "/resolve", { scope: "identities:read", cls: "resolve" }, async (ctx) => {
  const rl = await rateLimitDurable(`v1:resolve:${ctx.orgId}`, 600, 3_600_000);
  if (!rl.ok) throw err(429, "rate_limited", "Too many resolutions this hour.", { retry_after_seconds: rl.retryAfterSec });
  const b = ctx.body; const country = (str(b.country).toUpperCase() || "CM") as CountryCode;
  let m = str(b.identity) ? getMpi(str(b.identity)) : undefined;
  if (!m && str(b.phone)) m = findByAlias("phone", str(b.phone), country) ?? mpiForPhone(str(b.phone), country);
  if (!m && str(b.email)) m = findByAlias("email", str(b.email));
  if (!m && str(b.lightning_address)) m = findByAlias("lightning_address", str(b.lightning_address));
  if (!m && str(b.merchant_code)) m = mpiForMerchant(str(b.merchant_code));
  if (!m && str(b.business_id)) m = findByAlias("external_id", str(b.business_id));
  if (!m) return { reachable: false, identity_type: null, payment_capabilities: [] };
  const connected = !!m.orgId || m.type === "merchant" || m.aliases.some((a) => a.verified && a.type !== "momome_id" && a.type !== "lightning_address");
  const avail = fundingAvailable();
  return { reachable: true, identity: m.id, identity_type: m.type, display_name: m.type === "individual" && !connected ? null : m.displayName, connected, payment_capabilities: m.payment.methods.filter((x) => x === "momo_me" ? m.payment.momoBalance : avail[x]), lightning_address: m.aliases.find((a) => a.type === "lightning_address")?.value ?? null };
});

/* ---------- counterparties (§32) ---------- */
route("post", "/counterparties", { scope: "identities:write", idempotent: true, cls: "counterparties" }, async (ctx) => {
  const b = ctx.body; const contacts = Array.isArray(b.contacts) ? (b.contacts as Array<Record<string, unknown>>).map((c) => ({ type: str(c.type) as AliasType, value: str(c.value) })).filter((c) => ALIAS_TYPES.includes(c.type) && c.value) : [];
  if (!contacts.length) throw err(422, "invalid_request", "Give at least one contact: { type: phone|email|lightning_address|merchant_code|external_id, value }.");
  const r = createCounterparty(ctx.orgId, { name: str(b.name), contacts, country: (str(b.country).toUpperCase() || "CM") as CountryCode, metadata: b.metadata as Record<string, string> | undefined });
  if (!r.ok) throw err(422, "invalid_request", r.error === "name_required" ? "`name` is required." : `Invalid contact: ${r.error}.`);
  ctx.status = 201; return publicCounterparty(r.counterparty);
});
route("get", "/counterparties", { scope: "identities:read", cls: "counterparties" }, async (ctx) => ({ object: "list", data: counterpartiesOf(ctx.orgId).map(publicCounterparty) }));
route("post", "/counterparties/:id/link", { scope: "identities:write", cls: "counterparties" }, async (ctx) => {
  const cp = getCounterparty(ctx.params.id); if (!cp || cp.orgId !== ctx.orgId) throw err(404, "identity_not_found", "No such counterparty.");
  const m = getMpi(str(ctx.body.identity)); if (!m) throw err(404, "identity_not_found", "No such identity.");
  return publicCounterparty(linkToMpi(cp.id, m)!);
});

/* ---------- payment intents ---------- */
function intentInput(ctx: Ctx, surface: Surface) {
  const b = ctx.body; const amount = num((b.amount as Record<string, unknown>)?.value ?? b.amount);
  const payeeId = str((b.payee as Record<string, unknown>)?.identity ?? b.payee);
  const payee = payeeId ? getMpi(payeeId) : mine(ctx);
  if (!payee) throw err(404, "identity_not_found", "Unknown payee identity.");
  if (payee.orgId !== ctx.orgId && payee.type === "individual") throw err(403, "invalid_identity", "You can only create intents payable to identities you manage (or resolve a business first).");
  const p = (b.payer ?? {}) as Record<string, unknown>;
  // API surface: when the organization pays someone else and names no payer, it IS the payer.
  if (!Object.keys(p).length && payee.id !== mine(ctx).id) p.identity = mine(ctx).id;
  const permitted = Array.isArray(b.permitted_methods) ? (b.permitted_methods as unknown[]).map(str).filter((x): x is PaymentMethodId => METHODS.includes(x as PaymentMethodId)) : undefined;
  return { orgId: ctx.orgId, env: ctx.env, surface, payee, payer: Object.keys(p).length ? { mpi: str(p.identity) || undefined, counterparty: str(p.counterparty) || undefined, name: str(p.name) || undefined, phone: str(p.phone) || undefined } : undefined, amountXaf: amount, currency: str((b.amount as Record<string, unknown>)?.currency ?? b.currency) || "XAF", purpose: b.purpose && typeof b.purpose === "object" ? { type: (str((b.purpose as Record<string, unknown>).type) || "payment") as "payment", reference: str((b.purpose as Record<string, unknown>).reference) || undefined, description: str((b.purpose as Record<string, unknown>).description) || undefined } : undefined, permittedMethods: permitted, ttlMs: num(b.ttl_seconds) > 0 ? num(b.ttl_seconds) * 1000 : undefined, metadata: b.metadata as Record<string, string> | undefined, callbackUrl: str(b.callback_url) || undefined };
}
route("post", "/payment-intents", { scope: "payments:write", idempotent: true, cls: "intents" }, async (ctx) => wrap(() => { const i = createIntent(intentInput(ctx, "api")); meter(ctx.orgId, ctx.env, "payments"); auditCtx(ctx, "intent.created", { type: "payment_intent", id: i.id }); ctx.status = 201; return { ...publicIntent(i), route_preview: (() => { const d = routeFor(i); return "error" in d ? null : { method: d.method, transport: d.transport }; })() }; }));
route("get", "/payment-intents", { scope: "payments:read", cls: "intents" }, async (ctx) => ({ object: "list", data: intentsOf(ctx.orgId, ctx.env).map(publicIntent) }));
route("get", "/payment-intents/:id", { scope: "payments:read", cls: "intents" }, async (ctx) => { const i = getIntent(ctx.params.id); if (!i || i.orgId !== ctx.orgId) throw err(404, "payment_not_found", "No such payment intent."); return publicIntent(i); });
route("post", "/payment-intents/:id/execute", { scope: "payments:write", idempotent: true, cls: "intents", paymentEndpoint: true }, async (ctx) => wrap(async () => {
  const i = getIntent(ctx.params.id); if (!i || i.orgId !== ctx.orgId) throw err(404, "payment_not_found", "No such payment intent.");
  const wanted = str(ctx.body.method) as PaymentMethodId | ""; if (wanted && !METHODS.includes(wanted)) throw err(422, "invalid_request", "Unknown payment method.");
  const payerMpi = str((ctx.body.payer as Record<string, unknown>)?.identity) || (i.payer.mpi ? undefined : mine(ctx).id === i.payee.mpi ? undefined : mine(ctx).id);
  const out = await executeIntent(i, { req: ctx.req, wanted: wanted || undefined, payerMpi, payerPhone: str((ctx.body.payer as Record<string, unknown>)?.phone) || undefined, ownerForEngine: `org:${ctx.orgId}` });
  auditCtx(ctx, "intent.executed", { type: "payment_intent", id: i.id }, { route: out.route?.kind });
  return { ...publicIntent(out), route_explanation: out.route?.explanation ?? [] };
}));
route("post", "/payment-intents/:id/cancel", { scope: "payments:write", idempotent: true, cls: "intents" }, async (ctx) => { const i = getIntent(ctx.params.id); if (!i || i.orgId !== ctx.orgId) throw err(404, "payment_not_found", "No such payment intent."); if (!cancelIntent(i, "by the organization")) throw err(409, "payment_failed", "This intent can no longer be cancelled.", { status: i.status }); return publicIntent(i); });

/* ---------- invoices, payment links, QR, request-to-pay ---------- */
function invoiceInput(ctx: Ctx, kind: "invoice" | "payment_link" | "qr" | "request_to_pay") {
  const b = ctx.body; const amount = num((b.amount as Record<string, unknown>)?.value ?? b.amount);
  const payeeId = str((b.payee as Record<string, unknown>)?.identity ?? b.payee); const payee = payeeId ? owned(ctx, payeeId) : mine(ctx);
  const p = (b.payer ?? {}) as Record<string, unknown>;
  const payer = Object.keys(p).length ? { mpi: str(p.identity) || undefined, counterparty: str(p.counterparty) || undefined, name: str(p.name) || undefined, phone: str(p.phone) || undefined, email: str(p.email) || undefined } : undefined;
  if (kind === "request_to_pay" && !payer) throw err(422, "invalid_request", "A request-to-pay needs a known payer: { identity } or { counterparty } or { phone }.");
  const accepted = Array.isArray(b.accepted_methods) ? (b.accepted_methods as unknown[]).map(str).filter((x): x is PaymentMethodId => METHODS.includes(x as PaymentMethodId)) : undefined;
  return { orgId: ctx.orgId, env: ctx.env, kind, payee, amountXaf: amount, description: str(b.description) || undefined, reference: str(b.reference) || undefined, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(b.due_date)) ? str(b.due_date) : undefined, payer, acceptedMethods: accepted, metadata: b.metadata as Record<string, string> | undefined, callbackUrl: str(b.callback_url) || undefined, issue: b.issue !== false };
}
route("post", "/invoices", { scope: "invoices:write", idempotent: true, cls: "invoices" }, async (ctx) => wrap(() => { const kind = (str(ctx.body.kind) || "invoice") as "invoice" | "payment_link" | "qr"; if (!["invoice", "payment_link", "qr"].includes(kind)) throw err(422, "invalid_request", "kind must be invoice, payment_link or qr."); const inv = createInvoice(invoiceInput(ctx, kind)); auditCtx(ctx, "invoice.created", { type: "invoice", id: inv.id }); ctx.status = 201; return publicInvoice(inv); }));
route("post", "/requests", { scope: "invoices:write", idempotent: true, cls: "invoices" }, async (ctx) => wrap(() => { const inv = createInvoice(invoiceInput(ctx, "request_to_pay")); auditCtx(ctx, "request.created", { type: "invoice", id: inv.id }); ctx.status = 201; return publicInvoice(inv); }));
route("get", "/invoices", { scope: "invoices:read", cls: "invoices" }, async (ctx) => ({ object: "list", data: invoicesOf(ctx.orgId, ctx.env).map(publicInvoice) }));
route("get", "/invoices/:id", { scope: "invoices:read", cls: "invoices" }, async (ctx) => { const inv = getInvoice(ctx.params.id); if (!inv || inv.orgId !== ctx.orgId) throw err(404, "not_found", "No such invoice."); return publicInvoice(inv); });
route("post", "/invoices/:id/cancel", { scope: "invoices:write", idempotent: true, cls: "invoices" }, async (ctx) => { const inv = getInvoice(ctx.params.id); if (!inv || inv.orgId !== ctx.orgId) throw err(404, "not_found", "No such invoice."); if (!cancelInvoice(inv)) throw err(409, "payment_failed", `An invoice in ${inv.status} cannot be cancelled.`); const i = getIntent(inv.intentId); if (i) cancelIntent(i, "invoice cancelled"); return publicInvoice(inv); });

/* ---------- payouts (§13 lightning_send, Flow 2, Flow 5) ---------- */
route("post", "/payouts", { scope: "payouts:write", idempotent: true, cls: "payouts", paymentEndpoint: true }, async (ctx) => wrap(async () => {
  const b = ctx.body; const d = (b.destination ?? {}) as Record<string, unknown>;
  const payerId = str((b.source as Record<string, unknown>)?.identity); const payer = payerId ? owned(ctx, payerId) : mine(ctx);
  const p = await createPayout({ orgId: ctx.orgId, env: ctx.env, payer, amountXaf: num((b.amount as Record<string, unknown>)?.value ?? b.amount), destination: { phone: str(d.phone) || undefined, country: str(d.country) || undefined, lightning_address: str(d.lightning_address) || undefined, identity: str(d.identity) || undefined, name: str(d.name) || undefined }, reference: str(b.reference) || undefined, metadata: b.metadata as Record<string, string> | undefined });
  auditCtx(ctx, "payout.created", { type: "payout", id: p.id }, { xaf: p.amount.value, status: p.status });
  ctx.status = 201; return publicPayout(p);
}));
route("get", "/payouts", { scope: "payouts:read", cls: "payouts" }, async (ctx) => ({ object: "list", data: payoutsOf(ctx.orgId, ctx.env).map(publicPayout) }));
route("get", "/payouts/:id", { scope: "payouts:read", cls: "payouts" }, async (ctx) => { const p = getPayout(ctx.params.id); if (!p || p.orgId !== ctx.orgId) throw err(404, "not_found", "No such payout."); return publicPayout(p); });

/* ---------- hosted checkout (public: the payer holds nothing but the link) ---------- */
const checkoutView = async (id: string) => {
  const i = getIntent(id); if (!i) throw err(404, "payment_not_found", "This payment link does not exist.");
  // A lapsed Lightning invoice is retired the moment the checkout notices it, not on the next
  // reconcile sweep: cancelling an unfunded engine payment lets the intent drop the instruction
  // (onEnginePayment) and the payer picks a method again. Funded payments are never touched.
  if (i.execution?.kind === "external_payment" && i.execution.paymentId && !["completed", "failed", "expired", "reversed"].includes(i.status)) {
    const p = await store().getPayment(i.execution.paymentId);
    if (p && p.state === "AWAITING_INBOUND" && p.method === "LIGHTNING" && Date.parse(p.payInstruction.expiresAt) <= Date.now()) await cancelPayment(p, "checkout: funding instruction expired unpaid");
  }
  const payee = getMpi(i.payee.mpi); const avail = fundingAvailable();
  const methods = i.permittedMethods.filter((m) => m !== "momo_me" && m !== "bank_transfer" && avail[m]);
  return { id: i.id, status: i.status, settlement_status: i.settlementStatus, payee: { display_name: payee?.displayName ?? "MoMo›Me merchant", type: payee?.type ?? null, verified: !!payee?.aliases.some((a) => a.verified && a.type === "phone") }, amount: { value: String(i.amount.value), currency: i.amount.currency }, purpose: i.purpose, methods, execution: i.execution ? { method: i.execution.method, payment_id: i.execution.paymentId ?? null, payment_instructions: i.execution.instruction ?? null } : null, expires_at: i.expiresAt, livemode: i.env === "live" };
};
route("get", "/checkout/:id", { public: true, cls: "checkout" }, async (ctx) => checkoutView(ctx.params.id));
route("get", "/checkout/:id/status", { public: true, cls: "checkout" }, async (ctx) => { const v = await checkoutView(ctx.params.id); return { id: v.id, status: v.status, settlement_status: v.settlement_status, has_instruction: !!v.execution?.payment_instructions }; });
route("post", "/checkout/:id/pay", { public: true, cls: "checkout" }, async (ctx) => wrap(async () => {
  const rl = await rateLimitDurable(`v1:checkout:${ctx.ip}`, 30, 600_000);
  if (!rl.ok) throw err(429, "rate_limited", "Too many attempts. Retry shortly.", { retry_after_seconds: rl.retryAfterSec });
  const i = getIntent(ctx.params.id); if (!i) throw err(404, "payment_not_found", "This payment link does not exist.");
  const wanted = str(ctx.body.method) as PaymentMethodId; if (!METHODS.includes(wanted) || wanted === "momo_me") throw err(422, "invalid_request", "Choose lightning, stablecoin or mobile_money.");
  const payerPhone = str(ctx.body.payer_phone) || undefined; const payerName = str(ctx.body.payer_name) || undefined;
  if (payerPhone && !i.payer.mpi) { const m = mpiForPhone(payerPhone, getMpi(i.payee.mpi)!.country, payerName); if (m) i.payer.mpi = m.id; }
  if (payerName) i.payer.name = payerName;
  const out = await executeIntent(i, { req: ctx.req, wanted, payerPhone, ownerForEngine: `connect:${i.id}` });
  return checkoutView(out.id);
}));

/* ---------- sandbox ---------- */
route("post", "/sandbox/identities/:id/credit", { scope: "identities:write", cls: "sandbox" }, async (ctx) => {
  if (ctx.env !== "test" || deploymentEnv() !== "test") throw err(404, "not_found", "The sandbox surface exists only in the test environment.");
  const m = getMpi(ctx.params.id); if (!m) throw err(404, "identity_not_found", "No such identity.");
  const xaf = num(ctx.body.amount ?? (ctx.body.value as unknown)); if (!(xaf > 0)) throw err(422, "invalid_request", "amount must be positive.");
  creditBalance(`sandbox:${Date.now()}`, m.id, Math.round(xaf));
  return { identity: m.id, currency: "XAF", available: String(balanceOf(m.id)), sandbox: true };
});

/* ---------- settlement intents (per payment; §20) ---------- */
route("get", "/settlement-intents", { scope: "settlements:read", cls: "settlements" }, async (ctx) => ({ object: "list", data: settlementIntentsOf(ctx.orgId, ctx.env).map(publicSettlementIntent) }));
route("get", "/settlement-intents/:id", { scope: "settlements:read", cls: "settlements" }, async (ctx) => { const s = getSettlementIntent(ctx.params.id); if (!s || s.orgId !== ctx.orgId) throw err(404, "settlement_not_found", "No such settlement intent."); return publicSettlementIntent(s); });

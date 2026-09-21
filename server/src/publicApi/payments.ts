/* ============================================================
   POST /v1/payments · GET /v1/payments · GET /v1/payments/:id
   POST /v1/payments/:id/cancel · POST /v1/payments/:id/refund · POST /v1/payments/:id/retry

   Create: { quote_id, reference?, recipient: { phone, name? }, metadata?, confirmation_token? }
   Path: scope → limits → liquidity reservation → createPaymentCore() (the app's own function:
   recipient checks, name verification, compliance screen, quote claim, instruction mint)
   → meta (org, reference, metadata, compliance decision, reservation) → 201.
   A refusal from the core releases the reservation; nothing is minted twice.
   ============================================================ */
import { route, auditCtx, type Ctx } from "./index.js";
import { err, fromCore } from "./errors.js";
import { createPaymentCore } from "../routes/api.js";
import { store } from "../db/store.js";
import { COUNTRIES, checkPhone, splitDialed } from "../../../shared/domain.js";
import type { CountryCode, Payment } from "../../../shared/types.js";
import { quoteOwner } from "./quotes.js";
import { publicPayment, publicState, SOURCE_OF, TERMINAL } from "../core/platform/mapping.js";
import { putMeta, metaOf, metasOf, paymentByReference } from "../core/platform/paymentMeta.js";
import { checkLimits } from "../core/platform/limits.js";
import { reserveXaf, attachPayment, release } from "../core/platform/liquidity.js";
import { meter } from "../core/platform/usage.js";
import { planOfOrg } from "../core/platform/billing.js";
import { cancelPayment, completeRefund, retryDeliveryForSender } from "../core/stateMachine.js";
import { waitForPaymentChange } from "../core/paymentWatch.js";
import { enqueueEvent, markAnnounced } from "../core/interop/outbound.js";
import { scenarioOf, applyScenario, isDelayed, SCENARIO_NUMBERS } from "../core/platform/sandbox.js";
import { settle as engineSettle } from "../core/stateMachine.js";
import { background } from "../core/background.js";
import { deploymentEnv } from "./index.js";

const PHONE_REASON: Record<string, string> = { empty: "No number given.", foreign_country: "The number belongs to another country.", bad_length: "The number has the wrong number of digits for this country.", unknown_operator: "The number's prefix is not a Mobile Money operator we serve." };
const phoneMessage = (reason: string | undefined) => (reason && PHONE_REASON[reason]) || "Not a valid Mobile Money number for this country.";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function ownedPayment(ctx: Ctx, id: string): Promise<Payment> {
  const m = metaOf(id);
  if (!m || m.orgId !== ctx.orgId || m.env !== ctx.env) throw err(404, "payment_not_found", "Payment could not be found.");
  const p = await store().getPayment(id);
  if (!p) throw err(404, "payment_not_found", "Payment could not be found.");
  return p;
}

route("post", "/payments", { scope: "payments:write", idempotent: true, cls: "payments", paymentEndpoint: true }, async (ctx: Ctx) => {
  const b = ctx.body;
  const quoteId = str(b.quote_id);
  if (!quoteId) throw err(422, "validation_failed", "`quote_id` is required.", { field: "quote_id" });
  const qo = quoteOwner(quoteId);
  if (!qo || qo.orgId !== ctx.orgId || qo.env !== ctx.env) throw err(404, "quote_not_found", "No such quote for this organization.", { field: "quote_id" });
  const quote = await store().getQuote(quoteId);
  if (!quote) {
    const used = (await store().listPayments()).find((p) => p.quoteId === quoteId);
    if (used) throw err(409, "quote_already_used", "This quote was already used to create a payment.", { payment_id: used.id });
    throw err(410, "quote_expired", "This quote has expired. Create a new quote.");
  }
  if (Date.parse(quote.expiresAt) <= Date.now()) throw err(410, "quote_expired", "This quote has expired. Create a new quote.", { expired_at: quote.expiresAt });

  const rec = (b.recipient ?? {}) as Record<string, unknown>;
  const phoneRaw = str(rec.phone) || qo.phone || "";
  if (!phoneRaw) throw err(422, "validation_failed", "`recipient.phone` is required (E.164, e.g. +237670123456).", { field: "recipient.phone" });
  const country = qo.country as CountryCode;
  const sp = splitDialed(phoneRaw, country);
  if (sp.country !== country) throw err(422, "recipient_invalid", `The recipient number is not a ${COUNTRIES[country].name} number, but the quote is for ${country}.`, { field: "recipient.phone" });
  const chk = checkPhone(sp.local, country);
  if (!chk.ok || !chk.provider) throw err(422, "recipient_invalid", phoneMessage(chk.reason), { field: "recipient.phone", reason: chk.reason });
  const reference = str(b.reference).slice(0, 64) || undefined;
  if (reference) { const dup = paymentByReference(ctx.orgId, ctx.env, reference); if (dup) throw err(409, "validation_failed", `A payment with reference "${reference}" already exists.`, { field: "reference", payment_id: dup }); }
  const metadata: Record<string, string> = {};
  if (b.metadata && typeof b.metadata === "object") {
    for (const [k, v] of Object.entries(b.metadata as Record<string, unknown>).slice(0, 20)) if (/^[\w.-]{1,40}$/.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) metadata[k] = String(v).slice(0, 200);
  }

  // Limits (configurable, org-aware), before anything is reserved or minted.
  const src = SOURCE_OF[quote.method];
  const lim = await checkLimits({ orgId: ctx.orgId, env: ctx.env, plan: planOfOrg(ctx.orgId).id, country, asset: src.asset, currency: "XAF", operator: chk.provider, xaf: quote.xaf });
  if (!lim.ok) {
    const isCount = lim.limit.endsWith("count") || lim.limit.startsWith("velocity");
    throw err(422, "limit_exceeded", `This payment exceeds the ${lim.limit.replace(/_/g, " ")}: ${lim.ceiling.toLocaleString("en")}${isCount ? " payments" : " XAF"} (would be ${lim.value.toLocaleString("en")}).`, { limit: lim.limit, ceiling: lim.ceiling, value: lim.value, rule: lim.rule.name });
  }

  // Sandbox scenarios (test environment only) that refuse at creation.
  const scenario = ctx.env === "test" ? scenarioOf(chk.local) : "PAYMENT_SUCCESS";
  if (scenario === "INSUFFICIENT_LIQUIDITY") throw err(503, "insufficient_liquidity", "Not enough XAF liquidity for this payout right now. Retry shortly or reduce the amount.", { available_xaf: 0, sandbox_scenario: scenario });
  if (scenario === "PROVIDER_UNAVAILABLE") throw err(503, "provider_unavailable", "No payout provider can reach this operator right now. Retry shortly.", { sandbox_scenario: scenario });

  // Liquidity: reserve the XAF this payout will need. In the test environment an unknown
  // balance is allowed (the simulator has no float); live must know.
  const rsv = await reserveXaf(ctx.orgId, quote.xaf, { allowUnknown: ctx.env === "test" });
  if (!rsv.ok) throw err(503, "insufficient_liquidity", rsv.reason === "unknown_balance" ? "The payout float is momentarily unknown. Retry shortly." : "Not enough XAF liquidity for this payout right now. Retry shortly or reduce the amount.", { available_xaf: rsv.available });

  const body = { quoteId, recipient: { phone: chk.local, country, provider: chk.provider, name: str(rec.name).slice(0, 80), nameSource: str(rec.name) ? "user" : "unknown" }, ...(str(b.confirmation_token) ? { riskToken: str(b.confirmation_token) } : {}) };
  let r;
  try { r = await createPaymentCore(ctx.req, body); }
  catch (e) { release(rsv.reservation.id, "core_error"); throw e; }
  if (r.status !== 201 && r.status !== 200) {
    release(rsv.reservation.id, `refused:${(r.body as { error?: string })?.error ?? r.status}`);
    const cb = r.body as { error?: string; message?: string; code?: string; operatorName?: string; riskToken?: string; didYouMean?: unknown };
    if (cb.error === "confirm_recipient") throw err(409, "recipient_unverified", cb.message ?? "Confirm the recipient before paying.", { reason: cb.code, ...(cb.operatorName ? { registered_name: cb.operatorName } : {}), ...(cb.didYouMean ? { did_you_mean: cb.didYouMean } : {}), confirmation_token: cb.riskToken, how_to_proceed: "Repeat the request with `confirmation_token` (and a NEW Idempotency-Key) to confirm this recipient." });
    if (cb.error === "compliance_blocked") throw err(403, "compliance_blocked", cb.message ?? "This payment cannot be processed.", {});
    throw fromCore(r.status, r.body);
  }
  const p = r.body as Payment;
  if (scenario !== "PAYMENT_SUCCESS") await applyScenario(p, scenario);
  attachPayment(rsv.reservation.id, p.id);
  putMeta({ paymentId: p.id, orgId: ctx.orgId, appId: ctx.auth.credential.appId, credentialId: ctx.auth.credential.id, env: ctx.env, reference, metadata, requestId: ctx.requestId, createdAt: p.createdAt, reservationId: rsv.reservation.id,
    compliance: { status: p.complianceFlags?.length ? "REVIEW" : "CLEAR", reasons: p.complianceFlags ?? [], at: p.createdAt }, lastPublicState: publicState(p) });
  meter(ctx.orgId, ctx.env, "payments");
  auditCtx(ctx, "payment.created", { type: "payment", id: p.id }, { xaf: p.xaf, method: p.method, reference });
  // The creation transitions ran inside the core before the meta existed, so announce them
  // here: payment.created, then payment.awaiting_payment (the state the caller now holds).
  const pub = publicPayment(p);
  enqueueEvent(`org:${ctx.orgId}`, "payment.created", pub);
  if (pub.status === "AWAITING_PAYMENT") enqueueEvent(`org:${ctx.orgId}`, "payment.awaiting_payment", pub);
  markAnnounced(p.id, pub.status);
  ctx.status = 201;
  return pub;
});

route("get", "/payments", { scope: "payments:read", cls: "payments" }, async (ctx: Ctx) => {
  const limit = Math.min(100, Math.max(1, Number(ctx.query.limit ?? 25) || 25));
  const status = str(ctx.query.status).toUpperCase();
  const reference = str(ctx.query.reference);
  const since = ctx.query.created_after ? Date.parse(ctx.query.created_after) : NaN;
  const cursor = str(ctx.query.starting_after);
  let metas = metasOf(ctx.orgId, ctx.env).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (reference) metas = metas.filter((m) => m.reference === reference);
  if (Number.isFinite(since)) metas = metas.filter((m) => Date.parse(m.createdAt) >= since);
  if (cursor) { const i = metas.findIndex((m) => m.paymentId === cursor); if (i >= 0) metas = metas.slice(i + 1); }
  const out = [];
  for (const m of metas) {
    const p = await store().getPayment(m.paymentId); if (!p) continue;
    const pp = publicPayment(p);
    if (status && pp.status !== status) continue;
    out.push(pp); if (out.length > limit) break;
  }
  const has_more = out.length > limit;
  return { object: "list", data: out.slice(0, limit), has_more, ...(has_more ? { next_cursor: out[limit - 1].id } : {}) };
});

route("get", "/payments/:id", { scope: "payments:read", cls: "payments" }, async (ctx: Ctx) => {
  let p = await ownedPayment(ctx, ctx.params.id);
  // ?wait=<seconds> long-polls for a change from the state the client already knows (?state=).
  const wait = Math.min(30, Math.max(0, Number(ctx.query.wait ?? 0) || 0));
  if (wait > 0 && str(ctx.query.status) && publicState(p) === str(ctx.query.status).toUpperCase() && !TERMINAL.includes(publicState(p))) {
    await waitForPaymentChange(p.id, wait * 1000);
    p = (await store().getPayment(p.id)) ?? p;
  }
  return publicPayment(p);
});

route("post", "/payments/:id/cancel", { scope: "payments:write", idempotent: true, cls: "payments", paymentEndpoint: true }, async (ctx: Ctx) => {
  const p = await ownedPayment(ctx, ctx.params.id);
  const r = await cancelPayment(p, `org ${ctx.orgId} via API`);
  if (!r.ok) throw err(409, "payment_not_cancellable", r.reason === "already_paid" ? "Funds were already received for this payment; it cannot be cancelled. It will settle or be refunded." : "This payment is already closed.", { status: publicState(p) });
  auditCtx(ctx, "payment.cancelled", { type: "payment", id: p.id });
  return publicPayment((await store().getPayment(p.id)) ?? p);
});

route("post", "/payments/:id/refund", { scope: "refunds:write", idempotent: true, cls: "payments", paymentEndpoint: true }, async (ctx: Ctx) => {
  const p = await ownedPayment(ctx, ctx.params.id);
  const dst = (ctx.body.destination ?? {}) as Record<string, unknown>;
  const invoice = str(dst.invoice ?? dst.lightning_invoice ?? ctx.body.invoice).replace(/^lightning:/i, "");
  if (p.state === "DELIVERED") throw err(409, "payment_not_refundable", "This payment was delivered to the recipient's Mobile Money and cannot be reversed — MoMo›Me holds no funds after settlement.", { status: "COMPLETED" });
  if (p.state !== "REFUND_PENDING") throw err(409, "payment_not_refundable", `Only a payment awaiting refund can be refunded (status ${publicState(p)}).`, { status: publicState(p) });
  if (!invoice) throw err(422, "validation_failed", "Give the Lightning invoice to refund to: `destination: { asset: \"BTC\", network: \"LIGHTNING\", invoice: \"lnbc…\" }`. Use an amount-less invoice, or one for exactly the refundable amount.", { refundable_sats: p.refundSats ?? null });
  if (!/^ln(bc|tb|bcrt)\w+$/i.test(invoice)) throw err(422, "validation_failed", "That is not a valid Lightning invoice.", { field: "destination.invoice" });
  const r = await completeRefund(p, invoice);
  if (!r.ok) throw err(r.error === "not_refundable" ? 409 : 422, r.error === "not_refundable" ? "payment_not_refundable" : "validation_failed", r.error === "amount_mismatch" ? "The invoice amount must match the refundable amount, or be amount-less." : r.error === "refund_rate_unavailable" ? "Live rates are momentarily unavailable; retry shortly." : "The refund could not be processed with that invoice.", { reason: r.error });
  auditCtx(ctx, "payment.refund_requested", { type: "payment", id: p.id });
  return publicPayment((await store().getPayment(p.id)) ?? p);
});

/** Ask the engine to try the payout again (another rail, or the same rail now that it is back). */
route("post", "/payments/:id/retry", { scope: "payments:write", idempotent: true, cls: "payments", paymentEndpoint: true }, async (ctx: Ctx) => {
  const p = await ownedPayment(ctx, ctx.params.id);
  const r = await retryDeliveryForSender(p);
  if (!r.ok) throw err(409, "validation_failed", r.reason ?? "This payment cannot be retried now.", { status: publicState(p) });
  auditCtx(ctx, "payment.retry_requested", { type: "payment", id: p.id });
  return publicPayment((await store().getPayment(p.id)) ?? p);
});

/* ---------- sandbox (test environment only) ---------- */
route("get", "/sandbox/scenarios", { scope: "payments:read", cls: "sandbox" }, async (ctx: Ctx) => {
  if (ctx.env !== "test") throw err(404, "not_found", "The sandbox surface exists only in the test environment.");
  return { object: "list", data: [...SCENARIO_NUMBERS, { phone: "any other valid number", scenario: "PAYMENT_SUCCESS" }], pay: "POST /v1/sandbox/payments/{id}/pay simulates the customer's wallet paying the instruction." };
});
route("post", "/sandbox/payments/:id/pay", { scope: "payments:write", cls: "sandbox" }, async (ctx: Ctx) => {
  if (ctx.env !== "test" || deploymentEnv() !== "test") throw err(404, "not_found", "The sandbox surface exists only in the test environment.");
  const p = await ownedPayment(ctx, ctx.params.id);
  if (p.state !== "AWAITING_INBOUND") throw err(409, "validation_failed", `Only an AWAITING_PAYMENT payment can be paid (status ${publicState(p)}).`, { status: publicState(p) });
  if (publicState(p) === "EXPIRED") throw err(409, "validation_failed", "This payment's instruction has expired.", { status: "EXPIRED" });
  const delay = isDelayed(p.id) ? 20_000 : 0;
  if (delay) setTimeout(() => background(engineSettle(p)), delay).unref?.(); else background(engineSettle(p));
  return { ...publicPayment(p), sandbox: { paid: true, settles_in_seconds: delay / 1000 } };
});

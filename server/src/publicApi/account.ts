/* ============================================================
   GET /v1/account · GET /v1/account/balances · GET /v1/usage · GET /v1/health
   GET /v1/settlements · POST /v1/settlements · GET /v1/settlements/:id · POST /v1/settlements/:id/cancel
   GET /v1/transactions · GET /v1/transactions/:id   (the unified timeline of a payment)
   ============================================================ */
import { route, auditCtx, type Ctx, deploymentEnv } from "./index.js";
import { err } from "./errors.js";
import { applicationsOf } from "../core/platform/orgs.js";
import { planOfOrg, effectiveFeePct } from "../core/platform/billing.js";
import { usageSummary } from "../core/platform/usage.js";
import { orgBalance, requestSettlement, getSettlement, settlementsOf, cancelSettlement, publicSettlement } from "../core/platform/settlements.js";
import { metaOf, metasOf } from "../core/platform/paymentMeta.js";
import { publicPayment, publicState, SOURCE_OF } from "../core/platform/mapping.js";
import { store } from "../db/store.js";
import { entriesFor } from "../core/ledger.js";
import { eventsOf } from "../core/interop/outbound.js";
import { COUNTRIES, checkPhone, splitDialed } from "../../../shared/domain.js";
import { ratesFresh } from "../core/rates.js";
import { PAYOUTS } from "../adapters/payouts.js";
import { payoutHealth } from "../core/routing.js";
import { appVersion } from "../app.js";
import { assets } from "../core/upi/assets.js";
import { METHOD_OF } from "../core/platform/mapping.js";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

route("get", "/account", { scope: "account:read", cls: "account" }, async (ctx: Ctx) => {
  const org = ctx.auth.org; const plan = planOfOrg(org.id); const fee = effectiveFeePct(org.id, ctx.env);
  return {
    object: "account", organization: { id: org.id, name: org.name, country: org.country, status: org.status, kyb_status: org.kyb, live_enabled: org.liveEnabled, created_at: org.createdAt },
    application: { id: ctx.auth.credential.appId, name: applicationsOf(org.id).find((a) => a.id === ctx.auth.credential.appId)?.name ?? null },
    credential: { id: ctx.auth.credential.id, label: ctx.auth.credential.label, environment: ctx.env, scopes: ctx.auth.credential.scopes, created_at: ctx.auth.credential.createdAt, last_used_at: ctx.auth.credential.lastUsedAt ?? null },
    plan: { id: plan.id, name: plan.name, rate_limit_per_minute: plan.rateLimitRpm, payment_endpoint_limit_per_minute: plan.paymentEndpointRpm, platform_fee_pct: fee.feePct, min_fee_xaf: fee.minFeeXaf, volume_tiers: plan.tiers },
    environment: ctx.env, livemode: ctx.env === "live",
  };
});

route("get", "/account/balances", { scope: "account:read", cls: "account" }, async (ctx: Ctx) => {
  const b = orgBalance(ctx.orgId);
  return { object: "list", data: [{ currency: "XAF", available: String(b.available), pending_settlement: String(b.pending), note: "MoMo›Me settles pass-through: a payment's XAF goes straight to the recipient. This balance is credited only by products that collect on your behalf." }] };
});

route("get", "/usage", { scope: "usage:read", cls: "usage" }, async (ctx: Ctx) => {
  const to = str(ctx.query.to) || new Date().toISOString().slice(0, 10);
  const from = str(ctx.query.from) || new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw err(422, "validation_failed", "`from` and `to` must be YYYY-MM-DD.");
  const u = usageSummary(ctx.orgId, ctx.env, from, to);
  return { object: "usage", environment: ctx.env, ...u.summary, days: u.days };
});

/* ---------- settlements ---------- */
route("post", "/settlements", { scope: "settlements:write", idempotent: true, cls: "settlements" }, async (ctx: Ctx) => {
  const b = ctx.body;
  const currency = (str(b.currency) || "XAF").toUpperCase();
  if (currency !== "XAF") throw err(422, "currency_unsupported", "Settlements are paid in XAF.", { field: "currency" });
  const amount = Number(str(b.amount)); if (!Number.isFinite(amount) || amount <= 0 || amount !== Math.round(amount)) throw err(422, "validation_failed", "`amount` must be a whole number of XAF.", { field: "amount" });
  const d = (b.destination ?? {}) as Record<string, unknown>;
  let destination;
  if (str(d.type) === "bank") {
    if (!str(d.bank) || !str(d.account)) throw err(422, "validation_failed", "A bank destination needs `bank` and `account`.", { field: "destination" });
    destination = { type: "bank" as const, bank: str(d.bank).slice(0, 80), account: str(d.account).slice(0, 40), ...(str(d.name) ? { name: str(d.name).slice(0, 80) } : {}) };
  } else {
    const sp = splitDialed(str(d.phone), (str(d.country).toUpperCase() || "CM") as keyof typeof COUNTRIES);
    const chk = checkPhone(sp.local, sp.country);
    if (!chk.ok || !chk.provider) throw err(422, "recipient_invalid", "A mobile_money destination needs a valid Mobile Money `phone`.", { field: "destination.phone" });
    destination = { type: "mobile_money" as const, phone: `${COUNTRIES[sp.country].dial}${chk.local}`, operator: chk.provider, ...(str(d.name) ? { name: str(d.name).slice(0, 80) } : {}) };
  }
  const r = requestSettlement({ orgId: ctx.orgId, env: ctx.env, amountXaf: amount, destination, reference: str(b.reference).slice(0, 64) || undefined, requestId: ctx.requestId });
  if (!r.ok) throw err(r.error === "insufficient_balance" ? 409 : 422, r.error === "insufficient_balance" ? "insufficient_balance" : "settlement_invalid", r.error === "insufficient_balance" ? `Available balance is ${r.available} XAF.` : "Invalid settlement amount.", { available: r.available, currency: "XAF" });
  auditCtx(ctx, "settlement.requested", { type: "settlement", id: r.settlement.id }, { amount });
  ctx.status = 201;
  return publicSettlement(r.settlement);
});
route("get", "/settlements", { scope: "settlements:read", cls: "settlements" }, async (ctx: Ctx) => ({ object: "list", data: settlementsOf(ctx.orgId, ctx.env).slice(0, Math.min(100, Number(ctx.query.limit ?? 25) || 25)).map(publicSettlement) }));
route("get", "/settlements/:id", { scope: "settlements:read", cls: "settlements" }, async (ctx: Ctx) => {
  const s = getSettlement(ctx.params.id); if (!s || s.orgId !== ctx.orgId || s.env !== ctx.env) throw err(404, "settlement_not_found", "No such settlement.");
  return publicSettlement(s);
});
route("post", "/settlements/:id/cancel", { scope: "settlements:write", idempotent: true, cls: "settlements" }, async (ctx: Ctx) => {
  const s = getSettlement(ctx.params.id); if (!s || s.orgId !== ctx.orgId || s.env !== ctx.env) throw err(404, "settlement_not_found", "No such settlement.");
  if (!cancelSettlement(s)) throw err(409, "settlement_invalid", `A settlement in ${s.status} cannot be cancelled.`, { status: s.status });
  auditCtx(ctx, "settlement.cancelled", { type: "settlement", id: s.id });
  return publicSettlement(s);
});

/* ---------- transactions: the unified timeline ---------- */
async function timelineOf(ctx: Ctx, id: string) {
  const m = metaOf(id); if (!m || m.orgId !== ctx.orgId || m.env !== ctx.env) throw err(404, "payment_not_found", "Payment could not be found.");
  const p = await store().getPayment(id); if (!p) throw err(404, "payment_not_found", "Payment could not be found.");
  const pub = publicPayment(p);
  const steps: Array<{ at: string; step: string; detail?: string }> = [];
  steps.push({ at: p.createdAt, step: "customer_request", detail: `request ${m.requestId}` });
  steps.push({ at: p.createdAt, step: "quote", detail: p.quoteId });
  steps.push({ at: p.createdAt, step: "payment_created", detail: p.id });
  for (const e of p.events) steps.push({ at: e.at, step: `engine:${e.state}`, ...(e.note ? { detail: e.note } : {}) });
  if (p.payInstruction?.providerRef) steps.push({ at: p.createdAt, step: "digital_asset_instruction", detail: `${SOURCE_OF[p.method].asset}/${SOURCE_OF[p.method].network}` });
  if (p.payoutRef) steps.push({ at: p.events.find((e) => e.state === "PAYOUT_CONFIRMED")?.at ?? p.updatedAt, step: "provider_transaction", detail: `${p.aggregator ?? "rail"} ${p.payoutRef}` });
  const ledger = entriesFor(p.id).map((l) => ({ at: l.at, txn_id: l.txnId, account: l.account, direction: l.direction, amount: l.amount, currency: l.currency }));
  const webhooks = eventsOf(`org:${ctx.orgId}`, undefined, 200).filter((e) => (e.event as { data?: { id?: string } })?.data?.id === p.id).map((e) => ({ event_id: e.id, type: e.type, status: e.deliveredAt ? "delivered" : e.dead ? "dead" : "pending", attempts: e.attempts }));
  return { id: p.id, object: "transaction", reference: pub.reference, status: pub.status, payment: pub, compliance: m.compliance ?? null, liquidity_reservation: m.reservationId ?? null, steps: steps.sort((a, b) => a.at.localeCompare(b.at)), ledger, webhooks };
}
route("get", "/transactions", { scope: "payments:read", cls: "transactions" }, async (ctx: Ctx) => {
  const limit = Math.min(100, Math.max(1, Number(ctx.query.limit ?? 25) || 25));
  const metas = metasOf(ctx.orgId, ctx.env).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  const out = [];
  for (const m of metas) { const p = await store().getPayment(m.paymentId); if (p) out.push({ id: p.id, object: "transaction", reference: m.reference ?? null, status: publicState(p), amount: String(p.xaf), currency: "XAF", source_asset: SOURCE_OF[p.method].asset, created_at: p.createdAt, updated_at: p.updatedAt }); }
  return { object: "list", data: out };
});
route("get", "/transactions/:id", { scope: "payments:read", cls: "transactions" }, async (ctx: Ctx) => timelineOf(ctx, ctx.params.id));

/* ---------- health (public, no auth) ---------- */
route("get", "/health", { public: true, cls: "health" }, async () => {
  const rails = PAYOUTS.filter((p) => p.configured()).map((p) => ({ provider: p.name, ...payoutHealth(p.name) }));
  const env = deploymentEnv();
  return {
    status: rails.length && rails.every((r) => !r.eligible) ? "degraded" : "ok", environment: env, version: appVersion(),
    fx: { fresh: ratesFresh() },
    assets: assets().filter((a) => a.type !== "FIAT" && a.status !== "DISABLED").map((a) => ({ asset: a.code, network: a.network, status: METHOD_OF[`${a.code}/${a.network}`] ? "available" : "planned" })),
    countries: Object.values(COUNTRIES).map((c) => ({ code: c.code, currency: c.ccy, operators: c.providers, status: c.active ? "live" : "planned" })),
    payout_providers: rails.map((r) => ({ provider: r.provider, status: r.eligible ? "operational" : "degraded", success_rate: r.successRate })),
    time: new Date().toISOString(),
  };
});

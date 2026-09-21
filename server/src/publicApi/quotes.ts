/* ============================================================
   POST /v1/quotes · GET /v1/quotes/:id

   Body (either side may carry the amount):
     { source: { asset: "USDT", network: "ETHEREUM", amount?: "50.00" },
       destination: { country: "CM", currency: "XAF", amount?: "30000", phone?: "+2376…" } }
   The quote engine is destination-first (it prices `xaf`); a source-amount quote is solved
   by two engine calls: a first price at the implied XAF, then a re-price at the XAF that
   makes the source amount fit (never above what the sender said they would pay).
   ============================================================ */
import { route, type Ctx } from "./index.js";
import { err, fromCore } from "./errors.js";
import { buildQuote } from "../routes/api.js";
import { store } from "../db/store.js";
import { validateAssetNetwork } from "../core/upi/assets.js";
import { COUNTRIES, checkPhone, splitDialed } from "../../../shared/domain.js";
import type { CountryCode, Quote, Method } from "../../../shared/types.js";
import { METHOD_OF, publicQuote } from "../core/platform/mapping.js";
import { effectiveFeePct } from "../core/platform/billing.js";
import { meter } from "../core/platform/usage.js";
import { register, touch } from "../core/persist.js";

/** Who owns which quote (the engine's Quote has no owner). */
interface QuoteOwner { quoteId: string; orgId: string; env: string; country: string; phone?: string; at: string }
const owners = new Map<string, QuoteOwner>();
register("platform_quotes", () => [...owners.values()].filter((q) => Date.now() - Date.parse(q.at) < 86_400_000), (d: QuoteOwner[]) => { for (const q of d) owners.set(q.quoteId, q); });
export function quoteOwner(quoteId: string): QuoteOwner | undefined { return owners.get(quoteId); }

const PHONE_REASON: Record<string, string> = { empty: "No number given.", foreign_country: "The number belongs to another country.", bad_length: "The number has the wrong number of digits for this country.", unknown_operator: "The number's prefix is not a Mobile Money operator we serve." };
const phoneMessage = (reason: string | undefined) => (reason && PHONE_REASON[reason]) || "Not a valid Mobile Money number for this country.";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => { const s = str(v); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; };

async function engineQuote(xaf: number, method: Method, country: CountryCode, feePct: number): Promise<Quote> {
  const r = await buildQuote({ xaf: Math.round(xaf), method, country, feePct });
  if (r.status !== 200) throw fromCore(r.status, r.body);
  return r.body as Quote;
}

route("post", "/quotes", { scope: "quotes:write", idempotent: true, cls: "quotes" }, async (ctx: Ctx) => {
  const b = ctx.body;
  const src = (b.source ?? {}) as Record<string, unknown>; const dst = (b.destination ?? {}) as Record<string, unknown>;
  const asset = str(src.asset).toUpperCase(); const network = str(src.network).toUpperCase() || null;
  if (!asset) throw err(422, "validation_failed", "`source.asset` is required.", { field: "source.asset" });
  const va = validateAssetNetwork(asset, network);
  if (!va.ok) throw err(422, network ? "network_unsupported" : "asset_unsupported", va.reason, { field: network ? "source.network" : "source.asset", supported: Object.keys(METHOD_OF).map((k) => { const [a, n] = k.split("/"); return { asset: a, network: n }; }) });
  const method = METHOD_OF[`${va.asset.code}/${va.asset.network}`];
  if (!method) throw err(422, "asset_unsupported", `${va.asset.code} on ${va.asset.network} cannot fund a payment yet.`);
  const country = str(dst.country).toUpperCase() as CountryCode;
  if (!country || !COUNTRIES[country]) throw err(422, "country_unsupported", `Unsupported destination country${country ? ` ${country}` : ""}.`, { field: "destination.country", supported: Object.values(COUNTRIES).filter((c) => c.active).map((c) => c.code) });
  const currency = (str(dst.currency) || COUNTRIES[country].ccy).toUpperCase();
  if (currency !== COUNTRIES[country].ccy) throw err(422, "currency_unsupported", `${country} settles in ${COUNTRIES[country].ccy}.`, { field: "destination.currency" });
  let phone: string | undefined;
  if (str(dst.phone)) {
    const sp = splitDialed(str(dst.phone), country);
    const chk = checkPhone(sp.local, sp.country);
    if (!chk.ok) throw err(422, "recipient_invalid", phoneMessage(chk.reason), { field: "destination.phone" });
    phone = chk.local;
  }
  const dstAmount = num(dst.amount); const srcAmount = num(src.amount);
  if (!dstAmount && !srcAmount) throw err(422, "validation_failed", "Give an amount on `destination.amount` (XAF to deliver) or `source.amount` (asset to send).");
  const { feePct } = effectiveFeePct(ctx.orgId, ctx.env);

  let q: Quote;
  if (dstAmount) q = await engineQuote(dstAmount, method, country, feePct);
  else {
    // Source-first: price once at the XAF the asset buys, then fit under the source amount.
    const first = await engineQuote(1000, method, country, feePct);
    const xafGross = srcAmount! * first.rate;               // XAF the sender's amount buys, before fee
    const guess = Math.floor(xafGross - first.feeXaf * (xafGross / first.totalXaf));
    q = await engineQuote(Math.max(100, guess), method, country, feePct);
    if (q.inboundAmount > srcAmount!) q = await engineQuote(Math.max(100, Math.floor(q.xaf * (srcAmount! / q.inboundAmount)) - 1), method, country, feePct);
  }
  owners.set(q.id, { quoteId: q.id, orgId: ctx.orgId, env: ctx.env, country, phone, at: q.issuedAt }); touch("platform_quotes");
  meter(ctx.orgId, ctx.env, "quotes");
  ctx.status = 201;
  return publicQuote(q, country);
});

route("get", "/quotes/:id", { scope: "quotes:write", cls: "quotes" }, async (ctx: Ctx) => {
  const o = owners.get(ctx.params.id);
  if (!o || o.orgId !== ctx.orgId || o.env !== ctx.env) throw err(404, "quote_not_found", "No such quote for this organization.");
  const q = await store().getQuote(o.quoteId);
  if (!q) {
    // Consumed quotes are removed by the engine; say so rather than 404.
    const used = (await store().listPayments()).find((p) => p.quoteId === o.quoteId);
    if (used) return { id: o.quoteId, object: "quote", status: "used", payment_id: used.id };
    throw err(404, "quote_not_found", "No such quote for this organization.");
  }
  return publicQuote(q, o.country);
});

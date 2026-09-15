/* ============================================================
   Network routes — the interoperability layer's own surface, beside the live one.

   Customer-facing (device-authenticated like /api/*, and OFF until the flags say so):
     POST /api/network/intents                → intent + routes + quotes (best first)
     POST /api/network/intents/:id/confirm    → reserve liquidity, start collection
     GET  /api/network/transactions/:id       → the full lifecycle, by id or ref
   Sandbox-only simulation of provider events (§50 — "test the money"):
     POST /api/network/sim/:txId/collection   { status }
     POST /api/network/sim/:txId/payout       { status }
   Admin (mounted under the /admin guard in api.ts, section "rails"):
     GET  /api/admin/network                  → overview: flags, markets, corridors, liquidity,
                                                 transactions, reconciliation, shadow, monitoring
     PUT  /api/admin/network/settings         → flags / corridors / controls / weights / fx
     POST /api/admin/network/shadow/run       → run a shadow tick now
     POST /api/admin/network/tx/:id/recover   { action }
     POST /api/admin/network/tx/:id/refunded  { ref }
   ============================================================ */
import { Router, type Request, type Response } from "express";
import type { NetworkIntent, NetworkOverview, NetworkSettings } from "../../../shared/network.js";
import { getSettings, updateSettings } from "../core/settings.js";
import { id } from "../core/ids.js";
import { MARKETS, market, corridorId } from "../core/network/markets.js";
import { discover, corridorStatus } from "../core/network/router.js";
import * as saga from "../core/network/saga.js";
import * as liquidity from "../core/network/liquidity.js";
import { shadowTick, shadowReport, reconcile, monitoring } from "../core/network/shadow.js";
import { checklists, corridorChecklist } from "../core/network/activation.js";
import { fxFeedStatus, refreshPublicFx } from "../core/network/fx.js";
import { rateLimitDurableMiddleware } from "../core/ratelimit.js";

export const network = Router();
export const adminNetwork = Router();

const sandbox = () => process.env.RAILS_MODE === "sandbox";
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/* ---------- device authentication (RISK_REGISTER #9) ----------
   The same proof-of-possession gate as /api/* (routes/api.ts ownerOf: partner API key, or
   an enrolled device's per-request P-256 signature; a bare id only inside the migration
   window). api.ts injects it at load — the two routers import each other otherwise. The
   client signs the path relative to /api ("/network/intents"), so that is what we verify. */
type ReqLike = { headers: Record<string, string | string[] | undefined>; method?: string; url?: string; rawBody?: Buffer };
let resolveOwner: ((req: ReqLike) => Promise<string | undefined>) | null = null;
export function setOwnerResolver(fn: (req: ReqLike) => Promise<string | undefined>): void { resolveOwner = fn; }
async function ownerOf(req: Request): Promise<string | undefined> {
  if (!resolveOwner) return undefined; // not wired = nobody is authenticated
  const path = (req.originalUrl ?? req.url).replace(/^\/api/, "");
  return resolveOwner({ headers: req.headers as ReqLike["headers"], method: req.method, url: path, rawBody: (req as Request & { rawBody?: Buffer }).rawBody });
}
const unauthorized = (res: Response) => res.status(401).json({ error: "unauthorized", message: "Sign in on this device to use the network." });

/** The layer is reachable only when INTEROPERABILITY_V2 is on — or in the sandbox, where it
 *  is always available for rehearsal (nothing real can move there). */
function gate(_req: Request, res: Response, next: () => void): void {
  if (getSettings().network.flags.INTEROPERABILITY_V2 || sandbox()) return next();
  res.status(404).json({ error: "not_found", message: "Not available." });
}
network.use(gate);

/* ---------- intents (§20, §21) ---------- */
network.post("/intents", rateLimitDurableMiddleware("network_intents", 30, 60_000), async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return unauthorized(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const src = market(String(b.sourceMarket ?? "")), dst = market(String(b.destinationMarket ?? ""));
  if (!src || !dst) return res.status(400).json({ error: "bad_market", message: "Unknown source or destination market." });
  const amount = Number(b.sourceAmount);
  if (!Number.isFinite(amount) || amount < src.limits.minPerTx || amount > src.limits.maxPerTx) return res.status(400).json({ error: "bad_amount", message: `Amount must be ${src.limits.minPerTx}–${src.limits.maxPerTx} ${src.currency}.` });
  const sourcePhone = digits(b.sourcePhone), destinationPhone = digits(b.destinationPhone);
  if (destinationPhone.length < 8) return res.status(400).json({ error: "bad_recipient", message: "Enter the recipient's Mobile Money number." });
  const intent: NetworkIntent = {
    id: id("nin"), owner,
    sourceMarket: src.code, sourceProvider: String(b.sourceProvider ?? src.providers[0]?.id ?? ""), sourceCurrency: src.currency, sourcePhone,
    destinationMarket: dst.code, destinationProvider: String(b.destinationProvider ?? dst.providers[0]?.id ?? ""), destinationCurrency: dst.currency, destinationPhone,
    destinationName: typeof b.destinationName === "string" ? b.destinationName.slice(0, 80) : undefined,
    sourceAmount: Math.round(amount), status: "OPEN", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const { routes, quotes, reasons } = await discover(intent);
  for (const r of routes) saga.saveRoute(r);
  for (const q of quotes) saga.saveQuote(q);
  const best = routes.find((r) => r.available);
  intent.status = best ? "QUOTED" : "OPEN"; intent.routeId = best?.id; intent.quoteId = quotes.find((q) => q.routeId === best?.id)?.id;
  saga.saveIntent(intent);
  res.status(201).json({ intent, routes, quotes, best: best ? { route: best, quote: quotes.find((q) => q.routeId === best.id) } : null, unavailable: best ? [] : reasons.length ? reasons : routes.flatMap((r) => r.reasons) });
});

network.post("/intents/:id/confirm", rateLimitDurableMiddleware("network_confirm", 30, 60_000), async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return unauthorized(res);
  const intent = saga.getIntent(req.params.id);
  if (!intent) return res.status(404).json({ error: "not_found", message: "Intent not found." });
  if (intent.owner !== owner) return res.status(403).json({ error: "forbidden", message: "Not your intent." });
  const b = (req.body ?? {}) as { quoteId?: string; routeId?: string; sourcePhone?: string; shadow?: boolean };
  const quote = saga.getQuote(String(b.quoteId ?? intent.quoteId ?? ""));
  const route = saga.getRoute(String(b.routeId ?? quote?.routeId ?? intent.routeId ?? ""));
  if (!quote || !route || quote.intentId !== intent.id || route.intentId !== intent.id) return res.status(400).json({ error: "bad_quote", message: "Quote or route does not belong to this intent." });
  if (b.sourcePhone) { intent.sourcePhone = digits(b.sourcePhone); saga.saveIntent(intent); }
  if (intent.sourcePhone.length < 8) return res.status(400).json({ error: "bad_phone", message: "Enter the payer's Mobile Money number." });
  const r = await saga.begin(intent, quote, route, { shadow: !!b.shadow });
  if (!r.ok) return res.status(r.error === "quote_expired" ? 409 : r.error === "network_off" || r.error === "canary_refused" ? 403 : 409).json({ error: r.error, message: r.message });
  res.json({ transaction: r.tx });
});

network.get("/transactions/:id", async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return unauthorized(res);
  const t = saga.getTx(req.params.id) ?? saga.txByRef(req.params.id);
  if (!t) return res.status(404).json({ error: "not_found", message: "Transaction not found." });
  const intent = saga.getIntent(t.intentId);
  if (intent && intent.owner !== owner) return res.status(404).json({ error: "not_found", message: "Transaction not found." });
  res.json({ transaction: t, ledger: saga.ledgerFor(t.id) });
});

/* ---------- sandbox provider events ---------- */
network.post("/sim/:txId/collection", async (req, res) => {
  if (!sandbox()) return res.status(404).json({ error: "not_found" });
  const status = String((req.body ?? {}).status ?? "COMPLETED") as "COMPLETED" | "FAILED" | "PENDING";
  await saga.onCollectionEvent(req.params.txId, String((req.body ?? {}).eventId ?? `sim-col-${Date.now()}`), status);
  res.json({ transaction: saga.getTx(req.params.txId) });
});
network.post("/sim/:txId/payout", async (req, res) => {
  if (!sandbox()) return res.status(404).json({ error: "not_found" });
  const status = String((req.body ?? {}).status ?? "COMPLETED") as "COMPLETED" | "FAILED" | "PENDING";
  await saga.onPayoutEvent(req.params.txId, String((req.body ?? {}).eventId ?? `sim-pay-${Date.now()}`), status);
  res.json({ transaction: saga.getTx(req.params.txId) });
});

/* ---------- admin ---------- */
export async function overview(): Promise<NetworkOverview> {
  const s = getSettings().network;
  const [corridors, positions] = await Promise.all([corridorStatus(), liquidity.positions()]);
  const low = await liquidity.lowLiquidity();
  const mon = monitoring();
  // Checklists for the corridors an operator is working on: switched on, or cross-border
  // between two enabled markets (the domestic one is today's production flow).
  const lists = await checklists(corridors.filter((c) => c.source !== c.destination && (c.enabled || (market(c.source)!.enabled && market(c.destination)!.enabled))).map((c) => c.id));
  return {
    flags: s.flags,
    markets: Object.keys(MARKETS).map((code) => market(code)!).map((m) => ({ ...m, corridorsOut: corridors.filter((c) => c.source === m.code && c.status === "ACTIVE").length, liquidityAvailable: positions.filter((p) => p.market === m.code && p.available != null).reduce<number | null>((a, p) => (a ?? 0) + (p.available ?? 0), null) })),
    corridors, liquidity: positions, reservations: liquidity.reservationsList().slice(0, 100),
    transactions: saga.allTx(100),
    reconciliation: reconcile(), shadow: shadowReport(),
    monitoring: { payments: mon.payments, lightning: mon.lightning, liquidity: { lowAlerts: low } },
    weights: s.weights,
    checklists: lists, fx: fxFeedStatus(), canary: s.canary, marketOverrides: s.markets,
  };
}
adminNetwork.get("/network", async (_req, res) => res.json(await overview()));
adminNetwork.put("/network/settings", (req, res) => {
  const b = (req.body ?? {}) as Partial<NetworkSettings>;
  const cur = getSettings().network;
  // Every corridor key must be a known market pair; every weight non-negative; fx positive.
  if (b.corridors) for (const k of Object.keys(b.corridors)) { const [a, c] = k.split("-"); if (!MARKETS[a] || !MARKETS[c] || k !== corridorId(a, c)) return res.status(400).json({ error: "bad_corridor", message: `Unknown corridor ${k}.` }); }
  if (b.weights) for (const [k, v] of Object.entries(b.weights)) if (!(typeof v === "number" && v >= 0 && v <= 100)) return res.status(400).json({ error: "bad_weight", message: `${k} must be 0–100.` });
  if (b.fxUsd) for (const [k, v] of Object.entries(b.fxUsd)) if (!(typeof v === "number" && v > 0)) return res.status(400).json({ error: "bad_fx", message: `${k} must be a positive rate.` });
  if (b.fxSpreadBps !== undefined && !(typeof b.fxSpreadBps === "number" && b.fxSpreadBps >= 0 && b.fxSpreadBps <= 1000)) return res.status(400).json({ error: "bad_spread", message: "Spread must be 0–1000 bps." });
  // Market overrides: known market, known provider ids, booleans only; Cameroon stays on.
  if (b.markets) for (const [code, o] of Object.entries(b.markets)) {
    const base = MARKETS[code];
    if (!base) return res.status(400).json({ error: "bad_market", message: `Unknown market ${code}.` });
    if (code === "CM" && o?.enabled === false) return res.status(400).json({ error: "bad_market", message: "Cameroon is the live engine and cannot be switched off here — use the emergency controls." });
    if (o?.enabled !== undefined && typeof o.enabled !== "boolean") return res.status(400).json({ error: "bad_market", message: `${code}.enabled must be true or false.` });
    for (const [pid, roles] of Object.entries(o?.providers ?? {})) {
      if (!base.providers.some((p) => p.id === pid)) return res.status(400).json({ error: "bad_provider", message: `${pid} is not a provider in ${base.name}.` });
      for (const r of ["collect", "payout"] as const) if (roles?.[r] !== undefined && typeof roles[r] !== "boolean") return res.status(400).json({ error: "bad_provider", message: `${code}.${pid}.${r} must be true or false.` });
    }
  }
  // Canary: a list of owner ids, a 0–100 share, positive caps keyed by known corridor.
  if (b.canary) {
    const c = b.canary;
    if (c.allowlist !== undefined && !(Array.isArray(c.allowlist) && c.allowlist.every((x) => typeof x === "string" && x.length > 0 && x.length <= 120) && c.allowlist.length <= 500)) return res.status(400).json({ error: "bad_canary", message: "allowlist must be up to 500 owner ids." });
    if (c.rolloutPct !== undefined && !(typeof c.rolloutPct === "number" && c.rolloutPct >= 0 && c.rolloutPct <= 100)) return res.status(400).json({ error: "bad_canary", message: "rolloutPct must be 0–100." });
    for (const k of ["maxPerTx", "maxPerDay"] as const) for (const [cid, v] of Object.entries(c[k] ?? {})) {
      const [a, d] = cid.split("-");
      if (!MARKETS[a] || !MARKETS[d] || cid !== corridorId(a, d)) return res.status(400).json({ error: "bad_corridor", message: `Unknown corridor ${cid}.` });
      if (!(typeof v === "number" && v >= 0)) return res.status(400).json({ error: "bad_canary", message: `${k}.${cid} must be a non-negative amount (0 clears it).` });
    }
  }
  const next = updateSettings({ network: { ...cur, ...b, flags: { ...cur.flags, ...(b.flags ?? {}) }, corridors: { ...cur.corridors, ...(b.corridors ?? {}) }, disabled: { ...cur.disabled, ...(b.disabled ?? {}) }, weights: { ...cur.weights, ...(b.weights ?? {}) }, fxUsd: { ...cur.fxUsd, ...(b.fxUsd ?? {}) }, simulatedLiquidity: { ...cur.simulatedLiquidity, ...(b.simulatedLiquidity ?? {}) }, liquidityFloor: { ...cur.liquidityFloor, ...(b.liquidityFloor ?? {}) },
    markets: mergeMarkets(cur.markets, b.markets),
    canary: { ...cur.canary, ...(b.canary ?? {}), maxPerTx: { ...cur.canary.maxPerTx, ...(b.canary?.maxPerTx ?? {}) }, maxPerDay: { ...cur.canary.maxPerDay, ...(b.canary?.maxPerDay ?? {}) } } } });
  res.json({ network: next.network });
});
/** Per-market, per-provider deep merge so a patch of one role keeps the others. */
function mergeMarkets(cur: NetworkSettings["markets"], patch?: NetworkSettings["markets"]): NetworkSettings["markets"] {
  const out = { ...cur };
  for (const [code, o] of Object.entries(patch ?? {})) {
    const prev = out[code] ?? {};
    const providers = { ...(prev.providers ?? {}) };
    for (const [pid, roles] of Object.entries(o.providers ?? {})) providers[pid] = { ...(providers[pid] ?? {}), ...roles };
    out[code] = { enabled: o.enabled ?? prev.enabled, providers };
  }
  return out;
}
adminNetwork.get("/network/corridors/:id/checklist", async (req, res) => {
  const c = await corridorChecklist(req.params.id);
  if (!c) return res.status(404).json({ error: "not_found", message: "Unknown corridor." });
  res.json(c);
});
adminNetwork.post("/network/fx/refresh", async (_req, res) => res.json({ ...(await refreshPublicFx()), feed: fxFeedStatus() }));
adminNetwork.post("/network/shadow/run", async (_req, res) => res.json({ compared: await shadowTick(200), report: shadowReport() }));
adminNetwork.post("/network/tx/:id/recover", async (req, res) => {
  const action = String((req.body ?? {}).action ?? "");
  if (!["retry", "alternate_provider", "manual", "refund"].includes(action)) return res.status(400).json({ error: "bad_action", message: "action must be retry, alternate_provider, manual or refund." });
  const by = (req as unknown as { session?: { uid: string } }).session?.uid ?? "operator";
  const r = await saga.recover(req.params.id, action as "retry" | "alternate_provider" | "manual" | "refund", by);
  if (!r.ok) return res.status(r.error === "not_found" ? 404 : 409).json({ error: r.error, message: r.error === "not_recoverable" ? "This transaction is not in a recoverable state." : r.error === "no_alternate" ? "No alternate payout provider is configured for this market." : "Not found." });
  res.json({ transaction: saga.getTx(req.params.id) });
});
adminNetwork.post("/network/tx/:id/refunded", (req, res) => {
  const by = (req as unknown as { session?: { uid: string } }).session?.uid ?? "operator";
  const ok = saga.markRefunded(req.params.id, String((req.body ?? {}).ref ?? "manual"), by);
  if (!ok) return res.status(409).json({ error: "not_refund_pending", message: "This transaction is not awaiting a refund." });
  res.json({ transaction: saga.getTx(req.params.id) });
});

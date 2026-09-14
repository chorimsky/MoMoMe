/* ============================================================
   Capital Intelligence engine — every number here is COMPUTED from the
   settlement engine's own records (payments, double-entry ledger, the float
   the payout path gates on, pricing/cost settings) and the capital ledgers.
   Nothing is invented: an empty book yields zeros with a small sample size,
   never a plausible-looking figure.

   Each output names its sources and, where it derives a conclusion, shows
   the calculation. Forecasts are a stated statistical method with bounds
   and a confidence that falls with the sample size — no false precision.
   ============================================================ */
import type { Payment, Method, ProviderId, CountryCode } from "../../../../shared/types.js";
import type {
  IntelFilters, Period, IntelOverview, CapitalHealth, IntelLiquidity, StressInputs, StressPreset, StressResult, IntelTransactions, TxAgg, IntelRoutes, RouteIntel,
  IntelRevenue, RevenueSlice, IntelForecasts, Forecast, ForecastPoint, Horizon, ForecastMetric, IntelScenarios, ScenarioResult, ScenarioInputs, ScenarioName,
  CapitalRequirement, IntelEfficiency, EfficiencyRow, IntelConcentration, ConcentrationRow, ConcentrationDim, IntelRisk, RiskItem, RiskLevel, Urgency, Confidence,
  Source, Calculation, Freshness, CapitalType, MatchingResult, InvestorMatch, FundraisingOverview, Recommendation, Insight,
} from "../../../../shared/capital.js";
import { CAPITAL_TYPES, CAPITAL_TYPE_LABEL, HORIZONS, INVESTOR_STAGES } from "../../../../shared/capital.js";
import { store } from "../../db/store.js";
import { getSettings } from "../settings.js";
import { availableFloatXaf, floatBasisNote, strandedEarmarks } from "../stateMachine.js";
import { usdXaf, ratesMeta } from "../rates.js";
import { ledgerFor, listInvestors, listCampaigns, listOpportunities, proposalsFor, termSheetsFor, listInvestments, notifyCapital } from "./investors.js";
import { upsertDerivedRequirement, listRequirements, getRequirement, upsertRecommendation, retireStale, config as wfConfig } from "./workflow.js";

/** Mirrors the payout-float treasury size the liquidity view reports against. */
export const FLOAT_CAPACITY_XAF = 50_000_000;
const DAY = 86_400_000;
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number): number | null => (den > 0 ? r2((num / den) * 100) : null);
const now = () => new Date().toISOString();

/* ---------- dataset ---------- */
const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365 };
interface Dataset {
  period: Period; days: number; from: number; to: number;
  all: Payment[];          // every payment in window (attempts)
  completed: Payment[];    // delivered
  prevCompleted: Payment[];
  daily: Array<{ date: string; count: number; volume: number; failed: number; revenue: number; cost: number }>;
  asOf: string;
}
let cache: { key: string; at: number; ds: Dataset } | null = null;
function pricing() { return getSettings().pricing; }
export function spreadOf(p: Payment): number { const b = typeof p.spreadBps === "number" ? p.spreadBps : pricing().spreadBps[p.method]; return b > 0 && b < 10000 ? r0((p.totalXaf * b) / (10000 - b)) : 0; }
export function costOf(p: Payment): number { const c = pricing().costs; return r0(p.xaf * c.payoutPct + p.totalXaf * c.railPct + c.fixedXaf); }
export function grossOf(p: Payment): number { return p.feeXaf + spreadOf(p); }
const failedStates = new Set(["FAILED", "REFUNDED", "REFUND_PENDING", "MANUAL_REVIEW"]);
function isFailed(p: Payment): boolean { return failedStates.has(p.state); }
function settlementSec(p: Payment): number | null {
  const d = p.events.find((e) => e.state === "DELIVERED");
  return d ? Math.max(0, (Date.parse(d.at) - Date.parse(p.createdAt)) / 1000) : null;
}
function applyFilters(ps: Payment[], f: IntelFilters): Payment[] {
  return ps.filter((p) => (!f.country || f.country === "ALL" || p.recipient.country === f.country) && (!f.rail || f.rail === "ALL" || p.method === f.rail) && (!f.provider || f.provider === "ALL" || p.recipient.provider === f.provider));
}
export async function dataset(f: IntelFilters = {}): Promise<Dataset> {
  const period: Period = f.period && f.period in PERIOD_DAYS ? f.period : "30d";
  const key = JSON.stringify({ period, c: f.country, r: f.rail, p: f.provider });
  if (cache && cache.key === key && Date.now() - cache.at < 10_000) return cache.ds;
  const days = PERIOD_DAYS[period];
  const to = Date.now(), from = to - days * DAY, prevFrom = from - days * DAY;
  const every = applyFilters(await store().listPayments(), f).filter((p) => p.state !== "QUOTED");
  const inWin = (p: Payment, a: number, b: number) => { const t = Date.parse(p.createdAt); return t >= a && t < b; };
  const all = every.filter((p) => inWin(p, from, to));
  const completed = all.filter((p) => p.displayStatus === "Completed");
  const prevCompleted = every.filter((p) => inWin(p, prevFrom, from) && p.displayStatus === "Completed");
  const byDay = new Map<string, Dataset["daily"][number]>();
  for (let i = days - 1; i >= 0; i--) { const d = new Date(to - i * DAY).toISOString().slice(0, 10); byDay.set(d, { date: d, count: 0, volume: 0, failed: 0, revenue: 0, cost: 0 }); }
  for (const p of all) {
    const e = byDay.get(p.createdAt.slice(0, 10)); if (!e) continue;
    if (p.displayStatus === "Completed") { e.count++; e.volume += p.xaf; e.revenue += grossOf(p); e.cost += costOf(p); }
    else if (isFailed(p)) e.failed++;
  }
  const asOf = every.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), "") || now();
  const ds: Dataset = { period, days, from, to, all, completed, prevCompleted, daily: [...byDay.values()], asOf };
  cache = { key, at: Date.now(), ds };
  return ds;
}
function freshness(ds: Dataset, note?: string): Freshness { return { computedAt: now(), dataAsOf: ds.asOf, sampleSize: ds.completed.length, note }; }
const SRC = {
  tx: (ds: Dataset): Source => ({ kind: "transactions", ref: `payments:${ds.period}`, label: `Payments, last ${ds.days} days (${ds.completed.length} completed of ${ds.all.length})` }),
  ledger: (): Source => ({ kind: "ledger", ref: "ledger:fx_position", label: "Double-entry ledger" }),
  float: (): Source => ({ kind: "liquidity", ref: "float:available", label: `Payout float — ${floatBasisNote()}` }),
  pricing: (): Source => ({ kind: "pricing", ref: "settings:pricing", label: "Fee, spread and cost assumptions (Settings → Pricing)" }),
  capital: (t: CapitalType): Source => ({ kind: "capital_ledger", ref: `ledger:${t}`, label: `${CAPITAL_TYPE_LABEL[t]} capital ledger` }),
  forecast: (id: string): Source => ({ kind: "forecast", ref: id, label: `Forecast ${id}` }),
  requirement: (id: string): Source => ({ kind: "requirement", ref: id, label: `Capital requirement ${id}` }),
  investors: (): Source => ({ kind: "investors", ref: "investors", label: "Investor records" }),
  rates: (): Source => ({ kind: "pricing", ref: "rates:usdxaf", label: `USD/XAF ${r2(usdXaf())} (${ratesMeta().source ?? "rates"})` }),
};

/* ---------- aggregation helpers ---------- */
function agg(ps: Payment[], attempts: Payment[]): TxAgg {
  const volume = ps.reduce((s, p) => s + p.xaf, 0), revenue = ps.reduce((s, p) => s + grossOf(p), 0), cost = ps.reduce((s, p) => s + costOf(p), 0);
  const failed = attempts.filter(isFailed).length, settled = attempts.filter((p) => p.displayStatus !== "Pending").length;
  const secs = ps.map(settlementSec).filter((x): x is number => x != null).sort((a, b) => a - b);
  return { count: ps.length, volume, avgSize: ps.length ? r0(volume / ps.length) : 0, successRatePct: pct(ps.length, settled), failureRatePct: pct(failed, settled), settlementSecP50: secs.length ? r0(secs[Math.floor(secs.length / 2)]) : null, revenue, cost, margin: revenue - cost, marginPct: pct(revenue - cost, volume) };
}
const routeIdOf = (p: Payment) => `${p.method}>${p.recipient.provider}`;
const RAIL_LABEL: Record<Method, string> = { LIGHTNING: "Lightning", ONCHAIN: "Bitcoin on-chain", USDT: "USDT", USDC: "USDC" };
const routeLabel = (m: Method, prov: ProviderId) => `${RAIL_LABEL[m]} → MoMo›Me → ${prov} Mobile Money`;
function groupBy<K extends string>(ps: Payment[], key: (p: Payment) => K): Map<K, Payment[]> { const m = new Map<K, Payment[]>(); for (const p of ps) { const k = key(p); (m.get(k) ?? m.set(k, []).get(k)!).push(p); } return m; }

/* ---------- statistics for forecasts ---------- */
function stats(values: number[]) {
  const n = values.length, mean = n ? values.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  // least-squares slope per day
  let slope = 0;
  if (n > 2) { const xm = (n - 1) / 2; let num = 0, den = 0; values.forEach((v, i) => { num += (i - xm) * (v - mean); den += (i - xm) ** 2; }); slope = den ? num / den : 0; }
  return { n, mean, stdev: Math.sqrt(variance), slope, observations: values.filter((v) => v > 0).length };
}
function confidenceFor(obs: number, cv: number): Confidence { return obs >= 45 && cv < 0.8 ? "HIGH" : obs >= 10 ? "MEDIUM" : "LOW"; }
function projectSum(daily: number[], h: number): ForecastPoint {
  const s = stats(daily);
  // Damped trend: the slope decays so a short burst cannot compound into the horizon.
  let expected = 0; for (let d = 1; d <= h; d++) expected += Math.max(0, s.mean + s.slope * Math.min(d, 14));
  const band = 1.28 * s.stdev * Math.sqrt(h); // ≈80% interval on a sum of daily values
  return { expected: r0(expected), lower: r0(Math.max(0, expected - band)), upper: r0(expected + band), confidence: confidenceFor(s.observations, s.mean ? s.stdev / s.mean : 1) };
}
function projectSeries(daily: number[], horizon: number, startMs: number) {
  const s = stats(daily); const out: Forecast["series"] = []; let cum = 0;
  for (let d = 1; d <= horizon; d++) { cum += Math.max(0, s.mean + s.slope * Math.min(d, 14)); const band = 1.28 * s.stdev * Math.sqrt(d); out.push({ date: new Date(startMs + d * DAY).toISOString().slice(0, 10), expected: r0(cum), lower: r0(Math.max(0, cum - band)), upper: r0(cum + band) }); }
  return out;
}

/* ---------- liquidity requirement (the shared calculation) ---------- */
interface LiquidityNeed { demand: number; settlementBuffer: number; peakBuffer: number; operationalReserve: number; required: number; available: number; gap: number; calc: Calculation; settlementDays: number }
async function liquidityNeed(ds: Dataset, horizonDays = 30): Promise<LiquidityNeed> {
  const daily = ds.daily.map((d) => d.volume);
  const s = stats(daily);
  const secs = ds.completed.map(settlementSec).filter((x): x is number => x != null).sort((a, b) => a - b);
  const settlementDays = Math.max(1, Math.ceil((secs.length ? secs[Math.floor(secs.length * 0.95)] : 0) / 86_400));
  const demand = r0(projectSum(daily, horizonDays).expected);
  const settlementBuffer = r0(s.mean * settlementDays);
  const peak = Math.max(0, ...daily);
  const peakBuffer = r0(Math.max(0, peak - s.mean) * 2);
  const operationalReserve = r0(FLOAT_CAPACITY_XAF * 0.2);
  const available = Math.max(0, await availableFloatXaf());
  const required = demand + settlementBuffer + peakBuffer + operationalReserve;
  const gap = Math.max(0, required - available);
  const calc: Calculation = { id: `LIQ-${ds.period}-${horizonDays}`, formula: "Demand + Settlement buffer + Peak-demand buffer + Operational reserve − Available liquidity = Requirement", ccy: "XAF", result: required - available, steps: [
    { label: `Demand (next ${horizonDays} days, expected)`, value: demand, ccy: "XAF", note: `daily mean ${r0(s.mean)} XAF over ${ds.days} days, damped trend ${r0(s.slope)}/day` },
    { label: "Settlement buffer", value: settlementBuffer, ccy: "XAF", note: `${settlementDays} settlement day(s) × daily mean (p95 delivery time)` },
    { label: "Peak-demand buffer", value: peakBuffer, ccy: "XAF", note: `2 × (peak day ${r0(peak)} − mean)` },
    { label: "Operational reserve", value: operationalReserve, ccy: "XAF", note: "20% of float capacity (the liquidity floor)" },
    { label: "Available liquidity", value: -available, ccy: "XAF", note: floatBasisNote() },
  ] };
  return { demand, settlementBuffer, peakBuffer, operationalReserve, required, available, gap, calc, settlementDays };
}
function urgencyFor(gap: number, required: number, coverage: number | null): Urgency {
  if (gap <= 0) return "LOW";
  if (coverage != null && coverage < 0.5) return "CRITICAL";
  if (required > 0 && gap / required > 0.5) return "HIGH";
  if (required > 0 && gap / required > 0.2) return "MEDIUM";
  return "LOW";
}
function riskLevelFor(coverage: number | null): RiskLevel { return coverage == null ? "LOW" : coverage >= 1.2 ? "LOW" : coverage >= 1 ? "MEDIUM" : coverage >= 0.7 ? "HIGH" : "CRITICAL"; }

/* ---------- capital position (USD) ---------- */
function capitalPosition() {
  const byType = Object.fromEntries(CAPITAL_TYPES.map((t) => { const l = ledgerFor(t); return [t, { committed: l.balances.committed, received: l.balances.received, deployed: l.balances.deployed, available: l.balances.available, reserved: 0, idle: Math.max(0, l.balances.available) }]; })) as CapitalHealth["byType"];
  const total = CAPITAL_TYPES.reduce((s, t) => ({ committed: s.committed + byType[t].committed, received: s.received + byType[t].received, deployed: s.deployed + byType[t].deployed, available: s.available + byType[t].available, reserved: s.reserved + byType[t].reserved, idle: s.idle + byType[t].idle }), { committed: 0, received: 0, deployed: 0, available: 0, reserved: 0, idle: 0 });
  return { byType, total };
}

/* ============================================================ public API ============================================================ */
export async function overview(f: IntelFilters = {}): Promise<IntelOverview> {
  const ds = await dataset(f);
  const vol = ds.completed.reduce((s, p) => s + p.xaf, 0), prev = ds.prevCompleted.reduce((s, p) => s + p.xaf, 0);
  const gross = ds.completed.reduce((s, p) => s + grossOf(p), 0), costs = ds.completed.reduce((s, p) => s + costOf(p), 0);
  const need = await liquidityNeed(ds, 30);
  const coverage = need.required > 0 ? r2(need.available / need.required) : null;
  const cap = capitalPosition();
  const daily = ds.daily.map((d) => d.volume);
  const reqs = await requirements();
  const open = reqs.filter((r) => !["FUNDED", "ALLOCATED", "CLOSED"].includes(r.status));
  const current = open.reduce((s, r) => s + (r.ccy === "USD" ? r.amount * usdXaf() : r.amount), 0);
  const gapX = open.reduce((s, r) => s + (r.ccy === "USD" ? r.fundingGap * usdXaf() : r.fundingGap), 0);
  const availX = cap.total.available * usdXaf();
  return {
    freshness: freshness(ds), ccy: "XAF",
    volume: { current: vol, previous: prev, growthPct: prev > 0 ? r2(((vol - prev) / prev) * 100) : null, trend: daily.slice(-30), count: ds.completed.length, previousCount: ds.prevCompleted.length },
    revenue: { gross, net: gross - costs, costs, marginPct: pct(gross - costs, vol) },
    liquidity: { available: need.available, required: need.required, gap: need.gap, coverageRatio: coverage, basis: floatBasisNote() },
    capital: { ...cap.total, ccy: "USD" },
    forecast: { d30: projectSum(daily, 30), d90: projectSum(daily, 90), d180: projectSum(daily, 180) },
    requirement: { current: r0(current), availableCapital: r0(availX), fundingGap: r0(gapX), urgency: open.reduce<Urgency>((u, r) => (["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(r.urgency) > ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(u) ? r.urgency : u), "LOW"), ccy: "XAF" },
    sources: [SRC.tx(ds), SRC.float(), SRC.pricing(), ...CAPITAL_TYPES.map(SRC.capital), SRC.rates()],
  };
}

export async function health(f: IntelFilters = {}): Promise<CapitalHealth> {
  const ds = await dataset(f);
  const cap = capitalPosition();
  const gross = ds.completed.reduce((s, p) => s + grossOf(p), 0), vol = ds.completed.reduce((s, p) => s + p.xaf, 0);
  const returned = CAPITAL_TYPES.reduce((s, t) => s + ledgerFor(t).balances.returned, 0);
  return { freshness: freshness(ds), ccy: "USD", byType: cap.byType, total: cap.total, flow: [
    { stage: "CAPITAL", amount: cap.total.received, ccy: "USD", source: SRC.capital("OWN") },
    { stage: "ALLOCATED", amount: cap.total.deployed, ccy: "USD", source: SRC.capital("POWER") },
    { stage: "DEPLOYED", amount: cap.total.deployed, ccy: "USD", source: SRC.capital("POWER") },
    { stage: "OPERATING_ACTIVITY", amount: vol, ccy: "XAF", source: SRC.tx(ds) },
    { stage: "REVENUE", amount: gross, ccy: "XAF", source: SRC.pricing() },
    { stage: "RETURN", amount: returned, ccy: "USD", source: SRC.capital("SCALE") },
  ], sources: [...CAPITAL_TYPES.map(SRC.capital), SRC.tx(ds), SRC.pricing()] };
}

const PRESETS: Record<StressPreset, StressInputs> = {
  NORMAL: { volumeIncreasePct: 0, settlementDelayHours: 0, failureRatePct: 0, withdrawalPct: 0, peakDemandMultiplier: 1, reserveRequirementPct: 20 },
  ELEVATED: { volumeIncreasePct: 25, settlementDelayHours: 24, failureRatePct: 3, withdrawalPct: 10, peakDemandMultiplier: 1.5, reserveRequirementPct: 20 },
  STRESS: { volumeIncreasePct: 50, settlementDelayHours: 48, failureRatePct: 8, withdrawalPct: 25, peakDemandMultiplier: 2, reserveRequirementPct: 25 },
  SEVERE: { volumeIncreasePct: 100, settlementDelayHours: 96, failureRatePct: 15, withdrawalPct: 50, peakDemandMultiplier: 3, reserveRequirementPct: 30 },
};
export async function stress(inputsIn: Partial<StressInputs>, preset: StressPreset | "CUSTOM" = "CUSTOM", f: IntelFilters = {}): Promise<StressResult> {
  const ds = await dataset(f);
  const inputs: StressInputs = { ...PRESETS.NORMAL, ...(preset !== "CUSTOM" ? PRESETS[preset] : {}), ...Object.fromEntries(Object.entries(inputsIn).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) };
  const s = stats(ds.daily.map((d) => d.volume));
  const dailyDemand = s.mean * (1 + inputs.volumeIncreasePct / 100);
  const demand30 = dailyDemand * 30;
  const settlementBuffer = dailyDemand * (inputs.settlementDelayHours / 24 + 1);
  const retries = demand30 * (inputs.failureRatePct / 100);
  const peak = Math.max(0, dailyDemand * (inputs.peakDemandMultiplier - 1)) * 2;
  const subtotal = demand30 + settlementBuffer + retries + peak;
  const reserve = subtotal * (inputs.reserveRequirementPct / 100);
  const required = r0(subtotal + reserve);
  const current = Math.max(0, await availableFloatXaf());
  const projected = r0(current * (1 - inputs.withdrawalPct / 100));
  const gap = Math.max(0, required - projected);
  const coverage = required > 0 ? r2(projected / required) : null;
  return { preset, inputs, currentLiquidity: current, requiredLiquidity: required, projectedLiquidity: projected, gap, coverageRatio: coverage, riskLevel: riskLevelFor(coverage), ccy: "XAF", calculation: { id: `STRESS-${preset}`, formula: "(30-day demand + settlement buffer + failure retries + peak buffer) × (1 + reserve %) vs liquidity × (1 − withdrawal %)", ccy: "XAF", result: projected - required, steps: [
    { label: "Daily demand (stressed)", value: r0(dailyDemand), ccy: "XAF", note: `mean ${r0(s.mean)} × (1 + ${inputs.volumeIncreasePct}%)` },
    { label: "30-day demand", value: r0(demand30), ccy: "XAF" },
    { label: "Settlement buffer", value: r0(settlementBuffer), ccy: "XAF", note: `${inputs.settlementDelayHours}h delay + 1 day` },
    { label: "Failure retries", value: r0(retries), ccy: "XAF", note: `${inputs.failureRatePct}% of demand` },
    { label: "Peak buffer", value: r0(peak), ccy: "XAF", note: `${inputs.peakDemandMultiplier}× peak` },
    { label: "Reserve", value: r0(reserve), ccy: "XAF", note: `${inputs.reserveRequirementPct}%` },
    { label: "Projected liquidity", value: projected, ccy: "XAF", note: `${current} × (1 − ${inputs.withdrawalPct}%)` },
  ] } };
}

export async function liquidity(f: IntelFilters = {}): Promise<IntelLiquidity> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const total = FLOAT_CAPACITY_XAF, available = need.available, reserved = need.operationalReserve;
  const outflow30 = ds.daily.slice(-30).reduce((s, d) => s + d.volume, 0);
  const stranded = await strandedEarmarks();
  const breakdown = (key: (p: Payment) => string, label: (k: string) => string) => [...groupBy(ds.completed, key).entries()].map(([k, ps]) => { const v = ps.reduce((s, p) => s + p.xaf, 0); const share = need.required > 0 && outflow30 > 0 ? v / outflow30 : 0; return { key: k, label: label(k), available: r0(available * share), required: r0(need.required * share), utilizationPct: pct(v, available * share || v) }; });
  const inflows = groupBy(ds.completed, (p) => p.createdAt.slice(0, 10));
  let running = available;
  const series = [...ds.daily].reverse().map((d) => { const inflow = (inflows.get(d.date) ?? []).reduce((s, p) => s + p.totalXaf, 0); const row = { date: d.date, inflow, outflow: d.volume, float: r0(running) }; running = running + d.volume - inflow; return row; }).reverse();
  const presets = await Promise.all((Object.keys(PRESETS) as StressPreset[]).map(async (p) => [p, await stress({}, p, f)] as const));
  return {
    freshness: freshness(ds), ccy: "XAF", total, available, required: need.required, reserved, idle: Math.max(0, available - need.required), utilizationPct: pct(outflow30, available), turnover: available > 0 ? r2(outflow30 / available) : null,
    requiredReserve: need.operationalReserve, gap: need.gap, floorXaf: need.operationalReserve, basis: floatBasisNote(),
    byCurrency: [{ key: "XAF", label: "XAF payout float", available, required: need.required, utilizationPct: pct(outflow30, available) }],
    byCountry: breakdown((p) => p.recipient.country, (k) => k), byRail: breakdown((p) => p.method, (k) => RAIL_LABEL[k as Method] ?? k), byProvider: breakdown((p) => p.recipient.provider, (k) => `${k} Mobile Money`),
    series, requirementForecast: projectSeries(ds.daily.map((d) => d.volume), 90, ds.to).filter((_, i) => i % 3 === 0),
    stress: Object.fromEntries(presets) as Record<StressPreset, StressResult>, stranded: { count: stranded.length, xaf: stranded.reduce((s, e) => s + e.xaf, 0) },
    sources: [SRC.float(), SRC.tx(ds), SRC.ledger()],
  };
}

export async function transactions(f: IntelFilters = {}): Promise<IntelTransactions> {
  const ds = await dataset(f);
  const byRoute = [...groupBy(ds.all, routeIdOf).entries()].map(([routeId, attempts]) => { const [m, prov] = routeId.split(">") as [Method, ProviderId]; return { routeId, label: routeLabel(m, prov), ...agg(attempts.filter((p) => p.displayStatus === "Completed"), attempts) }; }).sort((a, b) => b.volume - a.volume);
  const rows = [...ds.all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400).map((p) => ({ id: p.id, ref: p.ref, at: p.createdAt, method: p.method, provider: p.recipient.provider, country: p.recipient.country, xaf: p.xaf, feeXaf: p.feeXaf, status: p.displayStatus, state: p.state, routeId: routeIdOf(p) }));
  return { freshness: freshness(ds), ccy: "XAF", totals: agg(ds.completed, ds.all), byRoute, daily: ds.daily.map((d) => ({ date: d.date, count: d.count, volume: d.volume, failed: d.failed })), rows, sources: [SRC.tx(ds), SRC.pricing()] };
}

export async function routes(f: IntelFilters = {}): Promise<IntelRoutes> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const total = ds.completed.reduce((s, p) => s + p.xaf, 0);
  const out: RouteIntel[] = [...groupBy(ds.all, routeIdOf).entries()].map(([routeId, attempts]) => {
    const [m, prov] = routeId.split(">") as [Method, ProviderId];
    const a = agg(attempts.filter((p) => p.displayStatus === "Completed"), attempts);
    const liq = total > 0 ? r0(need.required * (a.volume / total)) : 0;
    return { routeId, name: routeLabel(m, prov), source: RAIL_LABEL[m], destination: `${prov} Mobile Money`, intermediaries: m === "LIGHTNING" ? ["IBEX (Lightning)", "MoMo›Me FX + ledger", "Payout aggregator"] : m === "ONCHAIN" ? ["IBEX (on-chain)", "MoMo›Me FX + ledger", "Payout aggregator"] : ["Ethereum ERC-20", "MoMo›Me FX + ledger", "Payout aggregator"], volume: a.volume, count: a.count, successRatePct: a.successRatePct, settlementSecP50: a.settlementSecP50, cost: a.cost, revenue: a.revenue, margin: a.margin, marginPct: a.marginPct, liquidityRequirement: liq, capitalEfficiency: liq > 0 ? r2(a.volume / liq) : null };
  }).sort((a, b) => b.volume - a.volume);
  return { freshness: freshness(ds), ccy: "XAF", routes: out, sources: [SRC.tx(ds), SRC.float(), SRC.pricing()] };
}

export async function revenue(f: IntelFilters = {}): Promise<IntelRevenue> {
  const ds = await dataset(f);
  const c = pricing().costs;
  const slice = (key: string, label: string, ps: Payment[]): RevenueSlice => { const volume = ps.reduce((s, p) => s + p.xaf, 0), fees = ps.reduce((s, p) => s + grossOf(p), 0), provider = ps.reduce((s, p) => s + r0(p.xaf * c.payoutPct), 0), settle = ps.reduce((s, p) => s + r0(p.totalXaf * c.railPct + c.fixedXaf), 0); return { key, label, volume, customerFees: fees, providerCosts: provider, settlementCosts: settle, gross: fees, net: fees - provider - settle, marginPct: pct(fees - provider - settle, volume) }; };
  const by = (key: (p: Payment) => string, label: (k: string) => string) => [...groupBy(ds.completed, key).entries()].map(([k, ps]) => slice(k, label(k), ps)).sort((a, b) => b.gross - a.gross);
  return { freshness: freshness(ds), ccy: "XAF", totals: slice("all", "All", ds.completed), byCountry: by((p) => p.recipient.country, (k) => k), byRoute: by(routeIdOf, (k) => { const [m, pv] = k.split(">") as [Method, ProviderId]; return routeLabel(m, pv); }), byProvider: by((p) => p.recipient.provider, (k) => `${k} Mobile Money`), byProduct: by((p) => (p.merchantId ? "merchant" : p.source === "lnurl" ? "lightning_address" : "send"), (k) => ({ merchant: "Merchant payments", lightning_address: "Lightning Address", send: "Send flow" })[k] ?? k), daily: ds.daily.map((d) => ({ date: d.date, gross: d.revenue, net: d.revenue - d.cost })), sources: [SRC.tx(ds), SRC.pricing()] };
}

export async function forecasts(f: IntelFilters = {}): Promise<IntelForecasts> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const mk = (metric: ForecastMetric, daily: number[], ccy?: Forecast["ccy"]): Forecast => { const s = stats(daily); return { id: `F-${metric}-${ds.period}`, metric, ccy, horizons: Object.fromEntries(HORIZONS.map((h) => [h, projectSum(daily, h)])) as Record<Horizon, ForecastPoint>, method: "Damped linear trend on daily values; 80% interval = ±1.28σ√h", basis: { days: ds.days, observations: s.observations, dailyMean: r2(s.mean), dailyStdev: r2(s.stdev), trendPerDay: r2(s.slope) }, series: projectSeries(daily, 90, ds.to).filter((_, i) => i % 3 === 0) }; };
  const vol = mk("volume", ds.daily.map((d) => d.volume), "XAF"), cnt = mk("count", ds.daily.map((d) => d.count)), rev = mk("revenue", ds.daily.map((d) => d.revenue), "XAF"), mar = mk("margin", ds.daily.map((d) => d.revenue - d.cost), "XAF");
  // Liquidity / capital requirement forecasts scale the requirement with the volume forecast — same calculation, projected demand.
  const scaleReq = (metric: ForecastMetric, base: number): Forecast => ({ ...vol, id: `F-${metric}-${ds.period}`, metric, horizons: Object.fromEntries(HORIZONS.map((h) => { const v = vol.horizons[h]; const k = vol.horizons[30].expected > 0 ? 1 / vol.horizons[30].expected : 0; return [h, { expected: r0(base + (v.expected - vol.horizons[30].expected) * k * base), lower: r0(Math.max(0, base + (v.lower - vol.horizons[30].expected) * k * base)), upper: r0(base + (v.upper - vol.horizons[30].expected) * k * base), confidence: v.confidence }]; })) as Record<Horizon, ForecastPoint>, series: [] });
  const liq = scaleReq("liquidityRequirement", need.required), capReq = scaleReq("capitalRequirement", need.gap);
  const dailyOut = stats(ds.daily.map((d) => d.volume)).mean;
  const runway: Forecast = { id: `F-runwayDays-${ds.period}`, metric: "runwayDays", horizons: Object.fromEntries(HORIZONS.map((h) => [h, { expected: dailyOut > 0 ? r0(need.available / dailyOut) : 0, lower: dailyOut > 0 ? r0(need.available / (dailyOut * 1.5)) : 0, upper: dailyOut > 0 ? r0(need.available / (dailyOut * 0.75)) : 0, confidence: vol.horizons[h].confidence }])) as Record<Horizon, ForecastPoint>, method: "Float runway = available liquidity ÷ daily payout demand (no opex data is held; this is liquidity runway, not cash runway)", basis: vol.basis, series: [] };
  return { freshness: freshness(ds, "Forecasts are statistical projections of the settlement book, not commitments."), forecasts: [vol, cnt, rev, mar, liq, capReq, runway], sources: [SRC.tx(ds), SRC.float(), SRC.pricing()] };
}

const SCENARIOS: Record<ScenarioName, ScenarioInputs> = { CONSERVATIVE: { volumeMultiplier: 0.8, marginBps: -20, settlementDelayHours: 24, failureRatePct: 5 }, BASE: { volumeMultiplier: 1, marginBps: 0, settlementDelayHours: 0, failureRatePct: 2 }, AGGRESSIVE: { volumeMultiplier: 1.5, marginBps: 10, settlementDelayHours: 0, failureRatePct: 2 } };
export async function scenarios(f: IntelFilters = {}, custom?: Partial<ScenarioInputs>): Promise<IntelScenarios> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const base90 = projectSum(ds.daily.map((d) => d.volume), 90).expected;
  const gross = ds.completed.reduce((s, p) => s + grossOf(p), 0), vol = ds.completed.reduce((s, p) => s + p.xaf, 0), cost = ds.completed.reduce((s, p) => s + costOf(p), 0);
  const takeBps = vol > 0 ? ((gross - cost) / vol) * 10000 : 0;
  const capAvailX = capitalPosition().total.available * usdXaf();
  const run = (name: ScenarioResult["name"], inp: ScenarioInputs): ScenarioResult => {
    const v = r0(base90 * inp.volumeMultiplier), revenue = r0((v * (takeBps + inp.marginBps)) / 10000);
    const liq = r0((need.demand * inp.volumeMultiplier) + need.settlementBuffer * inp.volumeMultiplier * (1 + inp.settlementDelayHours / 24) + need.peakBuffer * inp.volumeMultiplier + need.operationalReserve + need.demand * inp.volumeMultiplier * (inp.failureRatePct / 100));
    const capReq = Math.max(0, liq - need.available), fundingGap = Math.max(0, capReq - capAvailX);
    const dailyOut = (v / 90) || 0;
    return { name, inputs: inp, d90: { volume: v, revenue, liquidityRequirement: liq, capitalRequirement: capReq, runwayDays: dailyOut > 0 ? r0(need.available / dailyOut) : null, fundingGap }, calculation: { id: `SCN-${name}`, formula: "Liquidity req. = demand×m + settlement buffer×m×(1+delay) + peak×m + reserve + demand×m×failure%; Capital req. = liquidity req. − available float; Gap = capital req. − available capital", ccy: "XAF", result: fundingGap, steps: [{ label: "90-day volume", value: v, ccy: "XAF", note: `base ${base90} × ${inp.volumeMultiplier}` }, { label: "Net revenue", value: revenue, ccy: "XAF", note: `${r2(takeBps + inp.marginBps)} bps net take` }, { label: "Liquidity requirement", value: liq, ccy: "XAF" }, { label: "Capital requirement", value: capReq, ccy: "XAF" }, { label: "Available capital (XAF equiv.)", value: r0(capAvailX), ccy: "XAF" }] } };
  };
  const out = (Object.keys(SCENARIOS) as ScenarioName[]).map((n) => run(n, SCENARIOS[n]));
  if (custom) out.push(run("CUSTOM", { ...SCENARIOS.BASE, ...Object.fromEntries(Object.entries(custom).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) }));
  return { freshness: freshness(ds), ccy: "XAF", scenarios: out, sources: [SRC.tx(ds), SRC.float(), SRC.pricing(), SRC.capital("POWER"), SRC.rates()] };
}

/** Derive the live requirements (liquidity/POWER from the float gap; growth/SCALE when the
 *  scenario gap exceeds the float gap) and merge with what management entered. */
let deriving: Promise<CapitalRequirement[]> | null = null;
export async function requirements(f: IntelFilters = {}): Promise<CapitalRequirement[]> {
  // Single-flight: two concurrent scans (a page load plus a poll) must not both pass the
  // "does it exist yet" check and mint twin requirements.
  if (deriving) return deriving;
  deriving = deriveRequirements(f).finally(() => { deriving = null; });
  return deriving;
}
async function deriveRequirements(f: IntelFilters): Promise<CapitalRequirement[]> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const capX = capitalPosition();
  const powerAvailX = r0(capX.byType.POWER.available * usdXaf());
  const coverage = need.required > 0 ? need.available / need.required : null;
  const s = stats(ds.daily.map((d) => d.volume));
  const conf = confidenceFor(s.observations, s.mean ? s.stdev / s.mean : 1);
  if (need.required > 0) {
    upsertDerivedRequirement({ capitalType: "POWER", amount: need.required, ccy: "XAF", purpose: "Payout liquidity for the next 30 days", geography: "CEMAC", rail: "ALL", currentAvailable: need.available + powerAvailX, fundingGap: Math.max(0, need.gap - powerAvailX), targetDate: new Date(ds.to + 30 * DAY).toISOString().slice(0, 10), urgency: urgencyFor(Math.max(0, need.gap - powerAvailX), need.required, coverage), scenario: "BASE", confidence: conf, calculation: { ...need.calc, steps: [...need.calc.steps, { label: "Undeployed liquidity capital (XAF equiv.)", value: -powerAvailX, ccy: "XAF", note: "POWER ledger available × USD/XAF" }] }, sources: [SRC.tx(ds), SRC.float(), SRC.capital("POWER"), SRC.rates()] });
  }
  const agg90 = (await scenarios(f)).scenarios.find((x) => x.name === "AGGRESSIVE")!;
  if (agg90.d90.capitalRequirement > need.gap) {
    upsertDerivedRequirement({ capitalType: "SCALE", amount: r0(agg90.d90.capitalRequirement - need.gap), ccy: "XAF", purpose: "Growth headroom if volume grows 50% over 90 days", geography: "CEMAC", rail: "ALL", currentAvailable: r0(capX.byType.SCALE.available * usdXaf()), fundingGap: Math.max(0, r0(agg90.d90.capitalRequirement - need.gap - capX.byType.SCALE.available * usdXaf())), targetDate: new Date(ds.to + 90 * DAY).toISOString().slice(0, 10), urgency: "LOW", scenario: "AGGRESSIVE", confidence: conf === "HIGH" ? "MEDIUM" : "LOW", calculation: agg90.calculation, sources: [SRC.tx(ds), SRC.capital("SCALE"), SRC.rates()] });
  }
  return listRequirements();
}

export async function efficiency(f: IntelFilters = {}): Promise<IntelEfficiency> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const total = ds.completed.reduce((s, p) => s + p.xaf, 0), gross = ds.completed.reduce((s, p) => s + grossOf(p), 0);
  const row = (key: string, label: string, capital: number, volume: number, rev: number, idle = Math.max(0, capital - volume)): EfficiencyRow => ({ key, label, capital: r0(capital), volumeSupported: r0(volume), revenue: r0(rev), turnover: capital > 0 ? r2(volume / capital) : null, revenuePerCapital: capital > 0 ? r2(rev / capital) : null, utilizationPct: pct(Math.min(volume, capital), capital), idle: r0(idle), ratio: capital > 0 ? r2((rev + volume * 0.01) / capital) : null });
  const share = (v: number) => (total > 0 ? v / total : 0);
  const by = (key: (p: Payment) => string, label: (k: string) => string) => [...groupBy(ds.completed, key).entries()].map(([k, ps]) => { const v = ps.reduce((s, p) => s + p.xaf, 0); return row(k, label(k), need.available * share(v), v, ps.reduce((s, p) => s + grossOf(p), 0)); }).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
  const x = usdXaf();
  const byType = CAPITAL_TYPES.map((t) => { const l = ledgerFor(t).balances; const cap = l.received * x; return row(t, `${CAPITAL_TYPE_LABEL[t]} (${t})`, cap, t === "POWER" ? total : 0, t === "SCALE" ? gross : 0, Math.max(0, l.available * x)); });
  const byRail = by((p) => p.method, (k) => RAIL_LABEL[k as Method] ?? k), byRoute = by(routeIdOf, (k) => { const [m, pv] = k.split(">") as [Method, ProviderId]; return routeLabel(m, pv); }), byCountry = by((p) => p.recipient.country, (k) => k);
  const ranked = [...byRail, ...byRoute].filter((r) => r.ratio != null);
  return { freshness: freshness(ds), ccy: "XAF", totals: row("all", "All liquidity", need.available, total, gross), byCapitalType: byType, byRail, byRoute, byCountry, findings: { mostEfficient: ranked[0]?.label ?? null, leastEfficient: ranked.length > 1 ? ranked[ranked.length - 1].label : null, underutilized: [...byType, ...byRail].filter((r) => r.capital > 0 && (r.utilizationPct ?? 0) < 30).map((r) => r.label), bottlenecks: byRoute.filter((r) => (r.utilizationPct ?? 0) > 90).map((r) => r.label) }, sources: [SRC.tx(ds), SRC.float(), ...CAPITAL_TYPES.map(SRC.capital), SRC.rates()] };
}

export async function concentration(f: IntelFilters = {}): Promise<IntelConcentration> {
  const ds = await dataset(f);
  const th = wfConfig.thresholds;
  const status = (share: number, t: number): RiskLevel => (share >= t ? "CRITICAL" : share >= t * 0.85 ? "HIGH" : share >= t * 0.6 ? "MEDIUM" : "LOW");
  const rows: ConcentrationRow[] = [];
  const push = (dim: ConcentrationDim, key: string, label: string, exposure: number, total: number, ccy: ConcentrationRow["ccy"]) => { const share = total > 0 ? r2((exposure / total) * 100) : 0; rows.push({ dim, key, label, exposure: r0(exposure), ccy, sharePct: share, thresholdPct: th[dim], status: status(share, th[dim]) }); };
  const total = ds.completed.reduce((s, p) => s + p.xaf, 0);
  for (const [k, ps] of groupBy(ds.completed, (p) => p.recipient.country)) push("country", k, k, ps.reduce((s, p) => s + p.xaf, 0), total, "XAF");
  for (const [k, ps] of groupBy(ds.completed, (p) => p.method)) push("rail", k, RAIL_LABEL[k as Method] ?? k, ps.reduce((s, p) => s + p.xaf, 0), total, "XAF");
  for (const [k, ps] of groupBy(ds.completed, (p) => p.recipient.provider)) push("provider", k, `${k} Mobile Money`, ps.reduce((s, p) => s + p.xaf, 0), total, "XAF");
  for (const [k, ps] of groupBy(ds.completed, (p) => (p.paidAsset ?? (p.method === "LIGHTNING" || p.method === "ONCHAIN" ? "BTC" : p.method)))) push("currency", k, `${k} inbound`, ps.reduce((s, p) => s + p.totalXaf, 0), ds.completed.reduce((s, p) => s + p.totalXaf, 0), "XAF");
  const capTotal = CAPITAL_TYPES.reduce((s, t) => s + ledgerFor(t).balances.received, 0);
  for (const t of CAPITAL_TYPES) { const b = ledgerFor(t).balances.received; if (b > 0) push("capitalType", t, CAPITAL_TYPE_LABEL[t], b, capTotal, "USD"); }
  const byInvestor = new Map<string, number>();
  for (const x of listInvestments()) byInvestor.set(x.investorId, (byInvestor.get(x.investorId) ?? 0) + x.received);
  const invTotal = [...byInvestor.values()].reduce((s, v) => s + v, 0);
  const names = new Map(listInvestors().map((i) => [i.id, i.name]));
  for (const [k, v] of byInvestor) if (v > 0) push("investor", k, names.get(k) ?? k, v, invTotal, "USD");
  rows.sort((a, b) => b.sharePct - a.sharePct);
  return { freshness: freshness(ds), thresholds: th, rows, sources: [SRC.tx(ds), ...CAPITAL_TYPES.map(SRC.capital), SRC.investors()] };
}

export async function risk(f: IntelFilters = {}): Promise<IntelRisk> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const conc = await concentration(f);
  const fc = await forecasts(f);
  const items: RiskItem[] = [];
  const coverage = need.required > 0 ? need.available / need.required : null;
  const prevNeed = stats(ds.daily.slice(0, Math.floor(ds.days / 2)).map((d) => d.volume)).mean, lateNeed = stats(ds.daily.slice(Math.floor(ds.days / 2)).map((d) => d.volume)).mean;
  const trend = (worse: boolean, better: boolean): RiskItem["trend"] => (worse ? "worsening" : better ? "improving" : "stable");
  const lvl = riskLevelFor(coverage);
  items.push({ id: "RISK-LIQ", category: "liquidity", level: lvl, score: coverage == null ? 10 : Math.max(0, Math.min(100, r0(100 - coverage * 60))), drivers: [`Coverage ratio ${coverage == null ? "n/a" : r2(coverage)}`, `Gap ${need.gap} XAF`, need.settlementDays > 1 ? `Settlement takes ${need.settlementDays} days at p95` : "Same-day settlement"], affectedArea: "Payout float", trend: trend(lateNeed > prevNeed * 1.2, lateNeed < prevNeed * 0.8), recommendedAction: need.gap > 0 ? "Raise liquidity (POWER) capital or top up the float before demand outruns it." : "Maintain the reserve; re-check after each volume step-up.", sources: [SRC.float(), SRC.tx(ds)] });
  const worstConc = (dim: ConcentrationDim) => conc.rows.filter((r) => r.dim === dim).sort((a, b) => b.sharePct - a.sharePct)[0];
  const cc = ["country", "rail", "provider", "currency"].map((d) => worstConc(d as ConcentrationDim)).filter(Boolean) as ConcentrationRow[];
  const worst = cc.sort((a, b) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(b.status) - ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(a.status))[0];
  items.push({ id: "RISK-CONC", category: "capital_concentration", level: worst?.status ?? "LOW", score: worst ? r0(Math.min(100, (worst.sharePct / worst.thresholdPct) * 70)) : 0, drivers: cc.map((r) => `${r.label}: ${r.sharePct}% of ${r.dim} exposure (threshold ${r.thresholdPct}%)`), affectedArea: worst ? `${worst.dim}: ${worst.label}` : "—", trend: "stable", recommendedAction: worst && worst.status !== "LOW" ? `Diversify away from ${worst.label}: open a second ${worst.dim} or cap its share.` : "Within thresholds.", sources: [SRC.tx(ds)] });
  const lowConf = fc.forecasts.filter((x) => x.horizons[90].confidence === "LOW").length;
  items.push({ id: "RISK-FC", category: "forecast", level: lowConf >= 3 ? "HIGH" : lowConf > 0 ? "MEDIUM" : "LOW", score: r0((lowConf / Math.max(1, fc.forecasts.length)) * 100), drivers: [`${fc.forecasts[0].basis.observations} days with activity in ${ds.days}`, `Daily volatility σ/μ = ${fc.forecasts[0].basis.dailyMean ? r2(fc.forecasts[0].basis.dailyStdev / fc.forecasts[0].basis.dailyMean) : "n/a"}`], affectedArea: "Forecasts and scenario outputs", trend: "stable", recommendedAction: lowConf ? "Treat forecasts as indicative; widen buffers until the book is longer." : "Forecast basis is adequate.", sources: [SRC.forecast(fc.forecasts[0].id)] });
  const a = agg(ds.completed, ds.all);
  const settleLevel: RiskLevel = a.settlementSecP50 == null ? "LOW" : a.settlementSecP50 > 3600 ? "HIGH" : a.settlementSecP50 > 900 ? "MEDIUM" : "LOW";
  items.push({ id: "RISK-SETTLE", category: "settlement", level: settleLevel, score: a.settlementSecP50 == null ? 0 : r0(Math.min(100, a.settlementSecP50 / 60)), drivers: [`p50 delivery ${a.settlementSecP50 == null ? "n/a" : `${r0(a.settlementSecP50 / 60)} min`}`, `${need.settlementDays} day(s) of float tied up in settlement`], affectedArea: "Payout rails", trend: "stable", recommendedAction: settleLevel === "LOW" ? "No action." : "Investigate slow payout confirmations with the aggregator; each hour of delay ties up float.", sources: [SRC.tx(ds)] });
  const opsLevel: RiskLevel = a.failureRatePct == null ? "LOW" : a.failureRatePct > 15 ? "CRITICAL" : a.failureRatePct > 8 ? "HIGH" : a.failureRatePct > 3 ? "MEDIUM" : "LOW";
  items.push({ id: "RISK-OPS", category: "operational", level: opsLevel, score: r0(Math.min(100, (a.failureRatePct ?? 0) * 5)), drivers: [`Failure rate ${a.failureRatePct ?? "n/a"}%`, `${ds.all.filter(isFailed).length} failed of ${ds.all.length} attempts`], affectedArea: "Delivery", trend: "stable", recommendedAction: opsLevel === "LOW" ? "No action." : "Review failure reasons (Admin → Reports → Why payments fail) and rail health.", sources: [SRC.tx(ds)] });
  const invRow = worstConc("investor");
  items.push({ id: "RISK-INV", category: "investor_concentration", level: invRow?.status ?? "LOW", score: invRow ? r0(Math.min(100, (invRow.sharePct / invRow.thresholdPct) * 70)) : 0, drivers: invRow ? [`${invRow.label} holds ${invRow.sharePct}% of funded capital`] : ["No funded capital yet"], affectedArea: "Capital base", trend: "stable", recommendedAction: invRow && invRow.status !== "LOW" ? "Broaden the investor base before the next raise." : "Within threshold.", sources: [SRC.investors(), ...CAPITAL_TYPES.map(SRC.capital)] });
  const rm = ratesMeta();
  const stale = !rm.updatedAt || Date.now() - Date.parse(rm.updatedAt) > 6 * 3600_000;
  const dq: RiskLevel = ds.completed.length < 10 ? "HIGH" : stale ? "MEDIUM" : "LOW";
  items.push({ id: "RISK-DATA", category: "data_quality", level: dq, score: dq === "HIGH" ? 70 : dq === "MEDIUM" ? 40 : 10, drivers: [`${ds.completed.length} completed payments in the window`, stale ? "FX rates older than 6 h" : "FX rates fresh", `Float basis: ${floatBasisNote()}`], affectedArea: "All intelligence outputs", trend: "stable", recommendedAction: dq === "LOW" ? "No action." : "Small or stale samples: read every number here with its sample size.", sources: [SRC.tx(ds), SRC.rates(), SRC.float()] });
  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const overall = items.reduce<RiskLevel>((m, i) => (order.indexOf(i.level) > order.indexOf(m) ? i.level : m), "LOW");
  if (overall === "CRITICAL") notifyCapital("RISK_ESCALATION", "Risk escalated to CRITICAL", items.filter((i) => i.level === "CRITICAL").map((i) => i.category).join(", "), "/capital-intelligence/risk");
  if (lvl === "CRITICAL" || lvl === "HIGH") notifyCapital("LIQUIDITY_WARNING", "Liquidity coverage below requirement", `Coverage ${coverage == null ? "n/a" : r2(coverage)} — gap ${need.gap} XAF.`, "/capital-intelligence/liquidity");
  return { freshness: freshness(ds), items, overall, sources: [SRC.tx(ds), SRC.float(), SRC.investors()] };
}

/* ---------- investor matching (fit ≠ close probability) ---------- */
export async function matching(requirementId: string): Promise<MatchingResult | null> {
  const req = getRequirement(requirementId);
  if (!req) return null;
  const ds = await dataset();
  const x = usdXaf();
  const gapUsd = req.ccy === "USD" ? req.fundingGap : req.fundingGap / x;
  const matches: InvestorMatch[] = listInvestors().filter((i) => !["CLOSED", "REPORTING"].includes(i.stage) && i.qualification.status !== "DECLINED").map((i) => {
    const p = i.preferences;
    const typeFit = p.capitalTypes.includes(req.capitalType) ? 30 : p.capitalTypes.length === 0 ? 10 : 0;
    const maxT = p.maxTicket > 0 ? p.maxTicket : i.committed || 0;
    const ticketFit = maxT <= 0 ? 8 : Math.min(25, r0((Math.min(maxT, gapUsd) / Math.max(1, gapUsd)) * 25));
    const geoFit = p.geographies.includes("GLOBAL") || p.geographies.includes("CEMAC") || p.geographies.includes(req.geography as never) ? 15 : 5;
    const horizonFit = req.capitalType === "POWER" ? (p.horizonMonths <= 24 ? 10 : 5) : p.horizonMonths >= 24 ? 10 : 5;
    const readiness = (i.kyc.status === "APPROVED" ? 12 : i.kyc.status === "SUBMITTED" || i.kyc.status === "IN_REVIEW" ? 6 : 0) + (i.qualification.status === "QUALIFIED" ? 8 : 0);
    const fit = Math.min(100, typeFit + ticketFit + geoFit + horizonFit + readiness);
    const stageIdx = INVESTOR_STAGES.indexOf(i.stage);
    const base = [5, 12, 25, 35, 45, 55, 70, 80, 88, 92, 95, 95, 95, 95, 95][Math.max(0, stageIdx)] ?? 5;
    const recency = i.lastContactAt ? Math.max(0.6, 1 - (Date.now() - Date.parse(i.lastContactAt)) / (180 * DAY)) : 0.7;
    const closeProb = r0(Math.min(97, base * recency * (i.kyc.status === "REJECTED" ? 0.1 : 1)));
    const capacity = maxT > 0 ? maxT : 0;
    const expected = r0(Math.min(capacity || gapUsd, gapUsd) * (closeProb / 100));
    const reasons = [typeFit >= 30 ? `Prefers ${CAPITAL_TYPE_LABEL[req.capitalType]} capital` : `Does not list ${CAPITAL_TYPE_LABEL[req.capitalType]} capital`, capacity ? `Ticket up to ${capacity} ${p.ccy}` : "Ticket size unknown", i.kyc.status === "APPROVED" ? "KYC approved" : `KYC ${i.kyc.status.toLowerCase().replace("_", " ")}`, i.qualification.status === "QUALIFIED" ? `Qualified (${i.qualification.score ?? "—"})` : `Qualification ${i.qualification.status.toLowerCase()}`, `Stage ${i.stage.replace(/_/g, " ").toLowerCase()}`];
    const match: InvestorMatch = { investorId: i.id, name: i.name, fitScore: fit, closeProbabilityPct: closeProb, expectedCapital: expected, capacity, ccy: "USD", preferredCapitalType: p.capitalTypes, horizonMonths: p.horizonMonths, geography: p.geographies.join(", "), strategicFit: i.type === "STRATEGIC" ? 90 : p.strategicInterests.length ? 60 : 30, complianceReady: i.kyc.status === "APPROVED", reasons, calculation: { id: `MATCH-${i.id}`, formula: "Fit = type(30) + ticket(25) + geography(15) + horizon(10) + readiness(20). Close probability = stage base rate × contact recency. Expected = min(capacity, gap) × close probability. Fit and close probability are never combined.", result: fit, steps: [{ label: "Type fit", value: typeFit }, { label: "Ticket fit", value: ticketFit }, { label: "Geography fit", value: geoFit }, { label: "Horizon fit", value: horizonFit }, { label: "Readiness", value: readiness }, { label: "Stage base rate %", value: base }, { label: "Recency factor", value: r2(recency) }, { label: "Close probability %", value: closeProb }, { label: "Expected capital (USD)", value: expected, ccy: "USD" }] } };
    return match;
  }).sort((a, b) => b.fitScore - a.fitScore);
  return { requirementId, freshness: freshness(ds), matches, sources: [SRC.investors(), SRC.requirement(req.id), SRC.rates()] };
}

export async function fundraising(): Promise<FundraisingOverview> {
  const ds = await dataset();
  const investors = listInvestors();
  const stage = (from: number) => investors.filter((i) => INVESTOR_STAGES.indexOf(i.stage) >= from);
  const cap = (list: typeof investors) => list.reduce((s, i) => s + (i.preferences.maxTicket || i.committed), 0);
  const props = investors.flatMap((i) => proposalsFor(i.id)).filter((p) => p.status !== "DECLINED" && p.status !== "SUPERSEDED");
  const ts = investors.flatMap((i) => termSheetsFor(i.id)).filter((t) => t.status !== "VOID");
  const campaigns = listCampaigns();
  const received = campaigns.reduce((s, c) => s + c.received, 0), expected = campaigns.reduce((s, c) => s + c.expected, 0), target = campaigns.reduce((s, c) => s + c.target, 0);
  return { freshness: freshness(ds), campaigns, funnel: { ccy: "USD", stages: [
    { key: "potential", label: "Potential capital", investors: investors.length, capital: cap(investors) },
    { key: "qualified", label: "Qualified investors", investors: stage(INVESTOR_STAGES.indexOf("QUALIFIED")).length, capital: cap(stage(INVESTOR_STAGES.indexOf("QUALIFIED"))) },
    { key: "interested", label: "Interested", investors: stage(INVESTOR_STAGES.indexOf("INTERESTED")).length, capital: cap(stage(INVESTOR_STAGES.indexOf("INTERESTED"))) },
    { key: "proposals", label: "Proposals", investors: new Set(props.map((p) => p.investorId)).size, capital: props.reduce((s, p) => s + p.amount, 0) },
    { key: "termsheets", label: "Term sheets", investors: new Set(ts.map((t) => t.investorId)).size, capital: ts.reduce((s, t) => s + t.amount, 0) },
    { key: "expected", label: "Expected funding", investors: campaigns.length, capital: expected },
    { key: "actual", label: "Actual funding", investors: new Set(listInvestments().filter((x) => x.received > 0).map((x) => x.investorId)).size, capital: received },
  ] }, pipelineCoveragePct: target > 0 ? pct(expected, target) : null, sources: [SRC.investors(), ...listOpportunities().slice(0, 1).map(() => SRC.capital("OWN"))] };
}

/* ---------- recommendations scan (rules over the outputs above) ---------- */
export async function scanRecommendations(f: IntelFilters = {}): Promise<Recommendation[]> {
  const ds = await dataset(f);
  const need = await liquidityNeed(ds, 30);
  const reqs = await requirements(f);
  const eff = await efficiency(f);
  const conc = await concentration(f);
  const rt = await routes(f);
  const fc = await forecasts(f);
  const live = new Set<string>();
  const conf = fc.forecasts[0].horizons[30].confidence;
  const confNote = `Forecast basis: ${fc.forecasts[0].basis.observations} active days of ${ds.days}.`;
  const mk = (r: Omit<Recommendation, "id" | "status" | "createdAt" | "updatedAt" | "history">) => { live.add(r.fingerprint); upsertRecommendation(r); };
  for (const r of reqs.filter((x) => x.fundingGap > 0 && !["FUNDED", "ALLOCATED", "CLOSED"].includes(x.status))) {
    mk({ type: "RAISE_CAPITAL", title: `Raise ${CAPITAL_TYPE_LABEL[r.capitalType]} capital for ${r.id}`, fingerprint: `RAISE:${r.id}`, inputs: [{ label: "Requirement", value: `${r.amount} ${r.ccy}`, source: SRC.requirement(r.id) }, { label: "Available", value: `${r.currentAvailable} ${r.ccy}`, source: SRC.float() }, { label: "Gap", value: `${r.fundingGap} ${r.ccy}`, source: SRC.requirement(r.id) }], calculation: r.calculation, output: `The engine projects a ${r.fundingGap} ${r.ccy} shortfall against the ${r.purpose.toLowerCase()} by ${r.targetDate} (${r.urgency.toLowerCase()} urgency).`, recommendation: `Consider opening a ${CAPITAL_TYPE_LABEL[r.capitalType]} fundraising campaign for at least ${r.fundingGap} ${r.ccy} and matching qualified investors to ${r.id}.`, confidence: r.confidence, confidenceNote: confNote, action: { kind: "OPEN_CAMPAIGN", label: "Open a fundraising campaign", params: { requirementId: r.id, capitalType: r.capitalType, amount: r.fundingGap, ccy: r.ccy } }, expectedOutcome: "Funding gap closed before the target date; liquidity coverage restored to ≥ 1.0.", risks: ["Raising liquidity capital adds return obligations.", "The gap is a projection; it shrinks if volume falls."], responsible: null });
  }
  const coverage = need.required > 0 ? need.available / need.required : null;
  if (coverage != null && coverage < 1) mk({ type: "REVIEW_LIQUIDITY", title: "Liquidity coverage below 1.0", fingerprint: "LIQ:coverage", inputs: [{ label: "Available", value: `${need.available} XAF`, source: SRC.float() }, { label: "Required (30d)", value: `${need.required} XAF`, source: SRC.tx(ds) }], calculation: need.calc, output: `Coverage ratio ${r2(coverage)} — the float covers ${r0(coverage * 100)}% of projected 30-day need.`, recommendation: "Review the payout float now: top up from treasury or slow non-critical outflows until coverage is back above 1.0.", confidence: conf, confidenceNote: confNote, action: { kind: "REVIEW_FLOAT", label: "Open liquidity", params: { href: "/capital-intelligence/liquidity" } }, expectedOutcome: "Coverage ≥ 1.0 within the settlement cycle.", risks: ["Refusing payouts damages trust faster than a thin float."], responsible: null });
  if (need.available < need.operationalReserve) mk({ type: "INCREASE_RESERVE", title: "Float below the operational reserve", fingerprint: "LIQ:reserve", inputs: [{ label: "Available", value: `${need.available} XAF`, source: SRC.float() }, { label: "Reserve (20% of capacity)", value: `${need.operationalReserve} XAF`, source: SRC.pricing() }], calculation: need.calc, output: `The float (${need.available} XAF) is under the ${need.operationalReserve} XAF reserve.`, recommendation: "Increase the reserve: move treasury proceeds into the payout float before the next peak day.", confidence: "HIGH", confidenceNote: "Reserve breach is a measured fact, not a projection.", action: { kind: "TREASURY", label: "Open treasury", params: { href: "/admin" } }, expectedOutcome: "Float back above the reserve.", risks: ["Treasury sweeps take a settlement cycle to land."], responsible: null });
  const idle = eff.byCapitalType.filter((r) => r.capital > 0 && (r.utilizationPct ?? 0) < 30);
  for (const r of idle) mk({ type: "REDUCE_IDLE_CAPITAL", title: `Underutilised ${r.label}`, fingerprint: `IDLE:${r.key}`, inputs: [{ label: "Capital", value: `${r.capital} XAF equiv.`, source: SRC.capital(r.key as CapitalType) }, { label: "Utilisation", value: `${r.utilizationPct ?? 0}%`, source: SRC.tx(ds) }], calculation: { id: `IDLE-${r.key}`, formula: "Utilisation = min(volume supported, capital) ÷ capital", result: r.utilizationPct ?? 0, steps: [{ label: "Capital", value: r.capital, ccy: "XAF" }, { label: "Volume supported", value: r.volumeSupported, ccy: "XAF" }, { label: "Idle", value: r.idle, ccy: "XAF" }] }, output: `${r.idle} XAF equiv. of ${r.label} sits idle.`, recommendation: "Propose an allocation of the idle balance to the payout float or return it per the agreement.", confidence: "MEDIUM", confidenceNote: "Utilisation depends on the period's volume.", action: { kind: "PROPOSE_ALLOCATION", label: "Propose allocation", params: { capitalType: r.key, amount: r.idle } }, expectedOutcome: "Higher capital turnover; lower cost of idle capital.", risks: ["Deploying reserve capital reduces the buffer for a stress event."], responsible: null });
  for (const c of conc.rows.filter((x) => x.status === "HIGH" || x.status === "CRITICAL")) mk({ type: "DIVERSIFY_CAPITAL", title: `${c.dim} concentration: ${c.label}`, fingerprint: `CONC:${c.dim}:${c.key}`, inputs: [{ label: "Exposure", value: `${c.exposure} ${c.ccy}`, source: c.dim === "investor" || c.dim === "capitalType" ? SRC.investors() : SRC.tx(ds) }, { label: "Share", value: `${c.sharePct}%`, source: SRC.tx(ds) }, { label: "Threshold", value: `${c.thresholdPct}%`, source: { kind: "settings", ref: "capital_config", label: "Concentration thresholds" } }], calculation: { id: `CONC-${c.key}`, formula: "Share = exposure ÷ total exposure", result: c.sharePct, steps: [{ label: "Exposure", value: c.exposure, ccy: c.ccy }, { label: "Threshold %", value: c.thresholdPct }] }, output: `${c.label} is ${c.sharePct}% of ${c.dim} exposure (threshold ${c.thresholdPct}%).`, recommendation: `Diversify: reduce reliance on ${c.label} or raise the threshold deliberately.`, confidence: "HIGH", confidenceNote: "Measured share of the period's activity.", action: null, expectedOutcome: "Share back under the threshold.", risks: ["Diversifying rails or providers may cost margin."], responsible: null });
  for (const r of rt.routes.filter((x) => x.count >= 3 && (x.marginPct ?? 0) <= 0)) mk({ type: "REVIEW_ROUTE", title: `Route loses money: ${r.name}`, fingerprint: `ROUTE:${r.routeId}`, inputs: [{ label: "Revenue", value: `${r.revenue} XAF`, source: SRC.pricing() }, { label: "Cost", value: `${r.cost} XAF`, source: SRC.pricing() }], calculation: { id: `ROUTE-${r.routeId}`, formula: "Margin = revenue − cost", result: r.margin, steps: [{ label: "Revenue", value: r.revenue, ccy: "XAF" }, { label: "Cost", value: r.cost, ccy: "XAF" }] }, output: `${r.name} nets ${r.margin} XAF on ${r.count} payments.`, recommendation: "Widen the spread on this rail or de-prioritise it in routing.", confidence: "MEDIUM", confidenceNote: "Costs are the configured assumptions, not invoices.", action: { kind: "PRICING", label: "Open pricing", params: { href: "/admin" } }, expectedOutcome: "Route margin ≥ 0.", risks: ["A wider spread reduces conversion."], responsible: null });
  if (conf === "LOW" && ds.completed.length > 0) mk({ type: "REVIEW_FORECAST", title: "Forecast confidence is low", fingerprint: "FC:low", inputs: [{ label: "Active days", value: String(fc.forecasts[0].basis.observations), source: SRC.forecast(fc.forecasts[0].id) }], calculation: { id: "FC-basis", formula: "Confidence from active days and σ/μ", result: fc.forecasts[0].basis.observations, steps: [{ label: "Daily mean", value: fc.forecasts[0].basis.dailyMean, ccy: "XAF" }, { label: "Daily σ", value: fc.forecasts[0].basis.dailyStdev, ccy: "XAF" }] }, output: "The volume forecast rests on too few active days for a reliable band.", recommendation: "Use the STRESS scenario for planning until the book is longer.", confidence: "HIGH", confidenceNote: "The sample size is a fact.", action: null, expectedOutcome: "Decisions sized to the wider band.", risks: [], responsible: null });
  for (const i of listInvestors().filter((x) => x.nextContactAt && Date.parse(x.nextContactAt) < Date.now() && !["CLOSED", "REPORTING"].includes(x.stage))) mk({ type: "FOLLOW_UP_INVESTOR", title: `Follow up ${i.name}`, fingerprint: `FOLLOW:${i.id}:${i.nextContactAt}`, inputs: [{ label: "Next contact", value: i.nextContactAt!, source: SRC.investors() }, { label: "Stage", value: i.stage, source: SRC.investors() }], calculation: { id: `FOLLOW-${i.id}`, formula: "Next-contact date has passed", result: 1, steps: [] }, output: `${i.name} was due for contact on ${i.nextContactAt!.slice(0, 10)}.`, recommendation: `${i.relationshipOwner ?? "The relationship owner"} should reach out and log the conversation.`, confidence: "HIGH", confidenceNote: "Calendar fact.", action: { kind: "OPEN_INVESTOR", label: "Open investor", params: { href: `/investors/${i.id}` } }, expectedOutcome: "Pipeline keeps moving.", risks: [], responsible: i.relationshipOwner });
  retireStale(live);
  return (await import("./workflow.js")).listRecommendations();
}

export async function insights(f: IntelFilters = {}): Promise<Insight[]> {
  const ov = await overview(f), rk = await risk(f), eff = await efficiency(f);
  const out: Insight[] = [];
  const at = now();
  out.push({ id: "INS-VOL", at, tone: (ov.volume.growthPct ?? 0) >= 0 ? "good" : "warn", title: "Volume", text: ov.volume.growthPct == null ? `${ov.volume.count} completed payments (${ov.volume.current} XAF); no prior period to compare.` : `Volume ${ov.volume.growthPct >= 0 ? "up" : "down"} ${Math.abs(ov.volume.growthPct)}% vs the previous period (${ov.volume.current} vs ${ov.volume.previous} XAF).`, sources: ov.sources.slice(0, 1) });
  out.push({ id: "INS-LIQ", at, tone: ov.liquidity.gap > 0 ? "bad" : "good", title: "Liquidity", text: ov.liquidity.gap > 0 ? `The float is ${ov.liquidity.gap} XAF short of the 30-day requirement (coverage ${ov.liquidity.coverageRatio}).` : `The float covers the 30-day requirement (coverage ${ov.liquidity.coverageRatio ?? "n/a"}).`, sources: [ov.sources[1]] });
  out.push({ id: "INS-RISK", at, tone: rk.overall === "LOW" ? "good" : rk.overall === "MEDIUM" ? "info" : "bad", title: "Risk", text: `Overall risk ${rk.overall}: ${rk.items.filter((i) => i.level !== "LOW").map((i) => `${i.category} ${i.level}`).join(", ") || "all categories low"}.`, sources: rk.sources });
  if (eff.findings.mostEfficient) out.push({ id: "INS-EFF", at, tone: "info", title: "Efficiency", text: `Most capital-efficient: ${eff.findings.mostEfficient}${eff.findings.leastEfficient ? `; least: ${eff.findings.leastEfficient}` : ""}.`, sources: eff.sources.slice(0, 1) });
  return out;
}
export { PRESETS as STRESS_PRESETS, SCENARIOS as SCENARIO_PRESETS };

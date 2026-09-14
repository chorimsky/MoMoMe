/* ============================================================
   Regulatory reporting — one period, every body, from the books.

   The compliance engine (compliance.ts) detects and records. This module turns the
   record and the ledger into the periodic REPORTS each authority expects, and keeps a
   register of what was filed, when, by whom — each filing pinned to the tamper-evident
   compliance chain.

   Bodies and instruments (see docs/compliance/README.md — engineering, not legal advice;
   confirm every threshold and deadline with counsel):

   · ANIF Cameroun (FIU) — Règlement N°02/24/CEMAC/UMAC/CM: suspicious-transaction reports
     "sans délai"; the large-transaction (CTR) register on request. The STR register is in
     compliance.ts; here it is summarised per period with the "how long has an escalated
     case waited" figure, because "without delay" is the obligation.
   · BEAC — Instruction N°002/GR/2026 (inbound remittance pre-financing to Mobile Money
     wallets): monthly declaration by the 5th, Annexes I (funds received), II (wallet
     credits), III (technical partners), plus the FX-repatriation evidence.
   · COBAC — R-2023/01 (internal AML/CFT control): the annual report on the programme —
     officer, KYC, cases, dispositions, STRs, integrity of the record, limits in force.
   · DGI (Direction Générale des Impôts) — monthly VAT return and corporate-income-tax
     advance (acompte IS) by the 15th of the following month; the Finance-Law levy on
     mobile-money transfers (operator-collected) reported for exposure. Every tax figure
     is computed from configurable rates over the platform fee — an ESTIMATE the
     accountant confirms, never a filing by itself.

   Nothing here touches the money path. All reads.
   ============================================================ */
import type {
  AdminSettings, AnifSummary, BeacAnnexes, CobacSummary, Payment, RegulatoryBody, RegulatoryFiling,
  RegulatoryObligation, RegulatoryReport, TaxSummary, TreasuryWithdrawal,
} from "../../../shared/types.js";
import { store } from "../db/store.js";
import { getSettings } from "./settings.js";
import { listIdentities } from "./identity.js";
import { allWithdrawals } from "./treasury.js";
import { allTransfers } from "./momoTransfer.js";
import * as compliance from "./compliance.js";
import { ibexConfigured, ibexLive, peexitConfigured, peexitLive, pawapayConfigured, pawapayLive, phoenixdConfigured, whatsappConfigured } from "../config.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

/* ---------- filing register ---------- */
const filings: RegulatoryFiling[] = [];
register("regulatory_filings", () => filings, (d: RegulatoryFiling[]) => { filings.push(...d); });

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const inPeriod = (iso: string, period: string) => iso.startsWith(period);
const yearOf = (period: string) => period.slice(0, 4);
/** ISO date of day `day` of the month AFTER `period` (deadlines are "by the Nth of the
 *  following month"). Clamped so a filingDay of 31 never rolls over. */
function nextMonthDay(period: string, day: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const completed = (p: Payment) => p.displayStatus === "Completed";
const refunded = (p: Payment) => p.state === "REFUNDED";
const round = (n: number) => Math.round(n);

/* ---------- BEAC Annexes I–III ---------- */
function beac(period: string, pays: Payment[], sweeps: readonly TreasuryWithdrawal[]): BeacAnnexes {
  const inb = new Map<string, BeacAnnexes["inbound"][number]>();
  const cr = new Map<string, BeacAnnexes["credits"][number]>();
  let refundedXaf = 0, refundedCount = 0;
  for (const p of pays) {
    if (refunded(p)) { refundedXaf += p.totalXaf; refundedCount++; }
    if (!completed(p)) continue;
    // Annex I — what actually arrived: the asset that was booked (USDC sent to a USDT
    // address is USDC), the instructed amount, the customer XAF it bought.
    const asset = p.paidAsset ?? p.payInstruction.asset;
    const k = `${asset}:${p.method}`;
    const a = inb.get(k) ?? { asset, method: p.method, count: 0, assetAmount: 0, usd: 0, xaf: 0 };
    a.count++; a.assetAmount += p.payInstruction.amount; a.usd += p.usd; a.xaf += p.totalXaf;
    inb.set(k, a);
    // Annex II — the wallet credit, by operator / country / rail.
    const agg = p.aggregator ?? "unknown";
    const ck = `${p.recipient.provider}:${p.recipient.country}:${agg}`;
    const c = cr.get(ck) ?? { provider: p.recipient.provider, country: p.recipient.country, aggregator: agg, count: 0, xaf: 0 };
    c.count++; c.xaf += p.xaf;
    cr.set(ck, c);
  }
  const inbound = [...inb.values()].map((a) => ({ ...a, assetAmount: +a.assetAmount.toFixed(8), usd: +a.usd.toFixed(2) })).sort((x, y) => y.xaf - x.xaf);
  const credits = [...cr.values()].sort((x, y) => y.xaf - x.xaf);
  const ps = sweeps.filter((w) => inPeriod(w.at, period));
  const sold = ps.filter((w) => typeof w.realizedXaf === "number");
  return {
    inbound,
    credits,
    // Annex III — who is in the chain. Configured = credentials present; active = live
    // environment. Static identities (name/role/country) are the disclosure itself.
    partners: [
      { name: "IBEX Hub (IBEX Mercado)", role: "Inbound crypto rail — Lightning, on-chain BTC, USDT/USDC; treasury custody", country: "United States", configured: ibexConfigured(), active: ibexLive() },
      { name: "Peexit (Peex)", role: "Mobile Money disbursement and collection — MTN MoMo, Orange Money", country: "Cameroon", configured: peexitConfigured(), active: peexitLive() },
      { name: "PawaPay", role: "Mobile Money disbursement — MTN MoMo", country: "United Kingdom (multi-market)", configured: pawapayConfigured(), active: pawapayLive() },
      { name: "phoenixd (ACINQ)", role: "Self-hosted Lightning node — second inbound rail", country: "France", configured: phoenixdConfigured(), active: phoenixdConfigured() },
      { name: "Meta Platforms (WhatsApp Business)", role: "Customer messaging and one-time codes", country: "United States", configured: whatsappConfigured(), active: whatsappConfigured() },
    ],
    repatriation: {
      sweeps: ps.length, sold: sold.length, unsold: ps.length - sold.length,
      customerXaf: round(ps.reduce((s, w) => s + (w.customerXaf ?? 0), 0)),
      realizedXaf: round(sold.reduce((s, w) => s + (w.realizedXaf ?? 0), 0)),
    },
    totals: {
      inboundCount: inbound.reduce((s, a) => s + a.count, 0),
      inboundXaf: inbound.reduce((s, a) => s + a.xaf, 0),
      inboundUsd: +inbound.reduce((s, a) => s + a.usd, 0).toFixed(2),
      creditCount: credits.reduce((s, c) => s + c.count, 0),
      creditXaf: credits.reduce((s, c) => s + c.xaf, 0),
      refundedXaf, refundedCount,
    },
  };
}

/* ---------- ANIF ---------- */
function anif(period: string, now: string): AnifSummary {
  const cases = compliance.listCases();
  const strs = compliance.listStrs().filter((s) => inPeriod(s.at, period));
  const inP = cases.filter((c) => inPeriod(c.at, period));
  const ctr = inP.filter((c) => c.type === "ctr_threshold");
  const open = cases.filter((c) => c.status === "open" || c.status === "escalated");
  const esc = cases.filter((c) => c.status === "escalated");
  const oldest = esc.length ? Math.max(...esc.map((c) => Date.parse(now) - Date.parse(c.dispositionAt ?? c.at))) : null;
  return {
    strsFiled: strs.length,
    strs: strs.map((s) => ({ id: s.id, at: s.at, amountXaf: s.amountXaf, ref: s.ref })),
    ctrCount: ctr.length, ctrXaf: ctr.reduce((s, c) => s + c.amountXaf, 0),
    sanctionsHits: inP.filter((c) => c.type === "sanctions").length,
    casesOpened: inP.length, casesOpen: open.length,
    oldestEscalatedDays: oldest === null ? null : Math.floor(oldest / 86_400_000),
  };
}

/* ---------- COBAC ---------- */
function cobac(period: string, pays: Payment[]): CobacSummary {
  const s = getSettings().compliance;
  const cases = compliance.listCases();
  const ids = listIdentities();
  const verified = ids.filter((i) => i.claimed).length;
  const byType: Record<string, number> = {};
  for (const c of cases) byType[c.type] = (byType[c.type] ?? 0) + 1;
  const y = yearOf(period);
  const ytdPays = pays.filter((p) => completed(p) && p.createdAt.startsWith(y));
  const meta = compliance.chainMeta();
  return {
    officer: s.officer || null,
    reportingEntity: s.reportingEntity || getSettings().company.brand,
    kyc: { verified, pending: Math.max(0, ids.length - verified) },
    casesByType: byType,
    dispositions: {
      cleared: cases.filter((c) => c.status === "cleared").length,
      escalated: cases.filter((c) => c.status === "escalated").length,
      reported: cases.filter((c) => c.status === "reported").length,
      open: cases.filter((c) => c.status === "open").length,
    },
    strsFiled: compliance.listStrs().length,
    integrityOk: meta.integrityOk, chainKeyed: meta.keyed, eventCount: meta.eventCount,
    retentionYears: s.retentionYears,
    velocityLimits: s.velocity,
    thresholds: { ctrXaf: s.ctrThresholdXaf, cddXaf: s.cddThresholdXaf },
    ytd: {
      payments: ytdPays.length,
      volumeXaf: ytdPays.reduce((a, p) => a + p.xaf, 0),
      casesOpened: cases.filter((c) => c.at.startsWith(y)).length,
      strsFiled: compliance.listStrs().filter((r) => r.at.startsWith(y)).length,
    },
  };
}

/* ---------- DGI: the month's tax position ---------- */
/** VAT carved out of (or added to) a gross fee, per the configured basis. */
export function vatOf(feeXaf: number, tax: AdminSettings["tax"]): { vat: number; exVat: number } {
  const r = tax.vatRatePct / 100;
  if (r <= 0) return { vat: 0, exVat: feeXaf };
  if (tax.feeIncludesVat) { const exVat = feeXaf / (1 + r); return { vat: feeXaf - exVat, exVat }; }
  return { vat: feeXaf * r, exVat: feeXaf };
}
function taxes(period: string, pays: Payment[], sweeps: readonly TreasuryWithdrawal[]): TaxSummary {
  const tax = getSettings().tax;
  const y = yearOf(period);
  // Revenue events: the platform fee on every completed payment and Mobile Money →
  // Mobile Money transfer, and the realized FX result of sweeps marked sold.
  type Rev = { at: string; feeXaf: number; volumeXaf: number };
  const revs: Rev[] = [
    ...pays.filter(completed).map((p) => ({ at: p.createdAt, feeXaf: p.feeXaf, volumeXaf: p.xaf })),
    ...allTransfers(100_000).filter((t) => t.state === "DELIVERED").map((t) => ({ at: t.createdAt, feeXaf: t.feeXaf, volumeXaf: t.xaf })),
  ];
  const month = revs.filter((r) => inPeriod(r.at, period));
  const fx = (from: (iso: string) => boolean) => sweeps.filter((w) => typeof w.realizedXaf === "number" && from(w.realizedAt ?? w.at)).reduce((s, w) => s + ((w.realizedXaf ?? 0) - (w.customerXaf ?? 0)), 0);
  const feeRevenueXaf = round(month.reduce((s, r) => s + r.feeXaf, 0));
  const { vat, exVat } = vatOf(feeRevenueXaf, tax);
  const realizedFxXaf = round(fx((iso) => inPeriod(iso, period)));
  const turnoverExVatXaf = round(exVat + realizedFxXaf);
  const volumeXaf = month.reduce((s, r) => s + r.volumeXaf, 0);
  const byDay = new Map<string, { feeXaf: number; vatXaf: number }>();
  for (const r of month) {
    const d = r.at.slice(0, 10);
    const cur = byDay.get(d) ?? { feeXaf: 0, vatXaf: 0 };
    cur.feeXaf += r.feeXaf; cur.vatXaf += vatOf(r.feeXaf, tax).vat;
    byDay.set(d, cur);
  }
  // Year to date, for the corporate-income-tax picture: turnover so far, advances the
  // monthly returns have (or will have) paid, and the indicative IS on it. Costs are not
  // netted here — that is the accountant's closing, not a monthly figure.
  const ytdRevs = revs.filter((r) => r.at.startsWith(y) && r.at.slice(0, 7) <= period);
  const ytdFee = round(ytdRevs.reduce((s, r) => s + r.feeXaf, 0));
  const ytdTurnover = round(vatOf(ytdFee, tax).exVat + fx((iso) => iso.startsWith(y) && iso.slice(0, 7) <= period));
  const advance = (t: number) => round(t * tax.turnoverAdvancePct / 100);
  return {
    rates: tax,
    payments: month.length,
    volumeXaf,
    feeRevenueXaf,
    realizedFxXaf,
    turnoverExVatXaf,
    vatXaf: round(vat),
    turnoverAdvanceXaf: advance(turnoverExVatXaf),
    momoLevyXaf: round(volumeXaf * tax.momoLevyPct / 100),
    ytd: {
      turnoverExVatXaf: ytdTurnover,
      advancesXaf: advance(ytdTurnover),
      corporateTaxEstimateXaf: round(ytdTurnover * tax.corporateRatePct / 100),
    },
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, feeXaf: round(v.feeXaf), vatXaf: round(v.vatXaf) })),
  };
}

/* ---------- the calendar: what is due for this period, and whether it was filed ---------- */
function obligations(period: string, now: string, b: BeacAnnexes, a: AnifSummary, t: TaxSummary): RegulatoryObligation[] {
  const tax = getSettings().tax;
  const filed = (body: RegulatoryBody, kind: string) => filings.find((f) => f.body === body && f.kind === kind && f.period === period);
  const status = (body: RegulatoryBody, kind: string, dueAt: string | null, nothing: boolean): RegulatoryObligation["status"] => {
    if (filed(body, kind)) return "filed";
    if (nothing) return "nothing_to_file";
    if (dueAt && now.slice(0, 10) > dueAt) return "overdue";
    return "due";
  };
  const fmt = (n: number) => n.toLocaleString("en");
  const list: Array<Omit<RegulatoryObligation, "status" | "filing"> & { nothing?: boolean }> = [
    {
      body: "BEAC", kind: "beac_annexes", title: "Monthly declaration — Annexes I, II, III", periodicity: "monthly",
      basis: "BEAC Instruction N°002/GR/2026 (inbound remittance pre-financing) — by the 5th of the following month",
      period, dueAt: nextMonthDay(period, 5),
      summary: `Annex I: ${b.totals.inboundCount} inbound receipts, ${fmt(b.totals.inboundXaf)} XAF (≈ $${fmt(b.totals.inboundUsd)}). Annex II: ${b.totals.creditCount} wallet credits, ${fmt(b.totals.creditXaf)} XAF. Annex III: ${b.partners.length} partners in the chain (${b.partners.filter((p) => p.configured).length} configured). Repatriation: ${b.repatriation.sold}/${b.repatriation.sweeps} sweeps marked sold.`,
      nothing: b.totals.inboundCount === 0 && b.totals.creditCount === 0,
    },
    {
      body: "ANIF", kind: "anif_str", title: "Suspicious transaction reports (déclarations de soupçon)", periodicity: "event",
      basis: "Règlement N°02/24/CEMAC/UMAC/CM — sans délai; tipping-off prohibited", period, dueAt: null,
      summary: a.strsFiled ? `${a.strsFiled} STR(s) filed this period.` : `No STR this period. ${a.casesOpen} case(s) still open${a.oldestEscalatedDays !== null ? `; oldest escalated case waiting ${a.oldestEscalatedDays} day(s)` : ""}.`,
      nothing: a.strsFiled === 0,
    },
    {
      body: "ANIF", kind: "anif_ctr", title: "Large-transaction register (CTR)", periodicity: "monthly",
      basis: `Règlement N°02/24 — transactions ≥ ${fmt(getSettings().compliance.ctrThresholdXaf)} XAF, held for the FIU`, period, dueAt: nextMonthDay(period, 5),
      summary: a.ctrCount ? `${a.ctrCount} transaction(s) at or above the threshold, ${fmt(a.ctrXaf)} XAF.` : "No transaction reached the threshold.",
      nothing: a.ctrCount === 0,
    },
    {
      body: "DGI", kind: "dgi_vat", title: "VAT return (TVA) on platform fees", periodicity: "monthly",
      basis: `CGI — ${tax.vatRatePct} % ${tax.feeIncludesVat ? "carved out of" : "on top of"} the fee; by the ${tax.filingDay}th of the following month`, period, dueAt: nextMonthDay(period, tax.filingDay),
      summary: `Fees ${fmt(t.feeRevenueXaf)} XAF → VAT ${fmt(t.vatXaf)} XAF on ${fmt(t.turnoverExVatXaf - t.realizedFxXaf)} XAF ex-VAT.`,
      nothing: t.feeRevenueXaf === 0,
    },
    {
      body: "DGI", kind: "dgi_acompte", title: "Corporate-income-tax advance (acompte IS)", periodicity: "monthly",
      basis: `CGI — ${tax.turnoverAdvancePct} % of turnover ex-VAT; by the ${tax.filingDay}th of the following month`, period, dueAt: nextMonthDay(period, tax.filingDay),
      summary: `Turnover ${fmt(t.turnoverExVatXaf)} XAF → advance ${fmt(t.turnoverAdvanceXaf)} XAF. Year to date: ${fmt(t.ytd.turnoverExVatXaf)} XAF turnover, ${fmt(t.ytd.advancesXaf)} XAF advances, indicative IS ${fmt(t.ytd.corporateTaxEstimateXaf)} XAF.`,
      nothing: t.turnoverExVatXaf === 0,
    },
    {
      body: "COBAC", kind: "cobac_annual", title: "Annual AML/CFT internal-control report", periodicity: "annual",
      basis: "COBAC R-2023/01 — the programme, its officer, cases, STRs and record integrity (confirm the submission date with COBAC)", period: yearOf(period), dueAt: null,
      summary: "Year-to-date figures are in the COBAC section; file once per year.",
      nothing: false,
    },
  ];
  return list.map(({ nothing, ...o }) => {
    const f = filed(o.body, o.kind);
    return { ...o, status: status(o.body, o.kind, o.dueAt, !!nothing), filing: f };
  });
}

/* ---------- the report ---------- */
export async function regulatoryReport(period: string, now: string = new Date().toISOString()): Promise<RegulatoryReport> {
  const pays = await store().listPayments();
  const sweeps = allWithdrawals();
  const b = beac(period, pays.filter((p) => inPeriod(p.createdAt, period)), sweeps);
  const a = anif(period, now);
  const c = cobac(period, pays);
  const t = taxes(period, pays, sweeps);
  const s = getSettings();
  const periods = new Set<string>([now.slice(0, 7), period]);
  for (const p of pays) if (completed(p)) periods.add(p.createdAt.slice(0, 7));
  for (const f of filings) periods.add(f.period);
  return {
    period, generatedAt: now,
    reportingEntity: s.compliance.reportingEntity || s.company.brand,
    officer: s.compliance.officer || null,
    obligations: obligations(period, now, b, a, t),
    beac: b, anif: a, cobac: c, tax: t,
    filings: [...filings].sort((x, y) => y.filedAt.localeCompare(x.filedAt)).slice(0, 200),
    periods: [...periods].filter((p) => PERIOD_RE.test(p)).sort().reverse(),
  };
}

/** Record that a report was filed with a body. Pinned to the compliance chain. */
export function markFiled(input: { body: RegulatoryBody; kind: string; period: string; by: string; reference?: string; note?: string }, at: string = new Date().toISOString()): { ok: true; filing: RegulatoryFiling } | { ok: false; error: string } {
  if (!["ANIF", "BEAC", "COBAC", "DGI"].includes(input.body)) return { ok: false, error: "bad_body" };
  if (!/^[a-z_]{3,40}$/.test(input.kind)) return { ok: false, error: "bad_kind" };
  if (!(PERIOD_RE.test(input.period) || /^\d{4}$/.test(input.period))) return { ok: false, error: "bad_period" };
  if (filings.some((f) => f.body === input.body && f.kind === input.kind && f.period === input.period)) return { ok: false, error: "already_filed" };
  const ev = compliance.recordFiling(input.by, `${input.body} · ${input.kind} · ${input.period}${input.reference ? ` · ref ${input.reference}` : ""}`, at);
  const filing: RegulatoryFiling = {
    id: id("fil"), body: input.body, kind: input.kind, period: input.period, filedAt: at, filedBy: input.by,
    reference: input.reference?.trim().slice(0, 120) || undefined, note: input.note?.trim().slice(0, 500) || undefined, eventSeq: ev.seq,
  };
  filings.unshift(filing);
  touch("regulatory_filings");
  return { ok: true, filing };
}

/* ---------- exports: one CSV per body, sectioned ---------- */
const cell = (v: unknown): string => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rows = (r: (string | number | boolean | undefined | null)[][]) => r.map((x) => x.map(cell).join(",")).join("\r\n");
const section = (title: string, header: string[], body: (string | number | boolean | undefined | null)[][]) => `# ${title}\r\n${rows([header, ...body])}\r\n`;

export function exportBody(rep: RegulatoryReport, body: RegulatoryBody): string {
  const head = `# ${body} — ${rep.reportingEntity} — period ${rep.period} — generated ${rep.generatedAt}${rep.officer ? ` — compliance officer ${rep.officer}` : ""}\r\n`;
  if (body === "BEAC") {
    const b = rep.beac;
    return head
      + section("Annex I — inbound funds received", ["asset", "method", "count", "asset_amount", "usd", "xaf"], b.inbound.map((a) => [a.asset, a.method, a.count, a.assetAmount, a.usd, a.xaf]))
      + section("Annex II — Mobile Money wallet credits", ["operator", "country", "aggregator", "count", "xaf"], b.credits.map((c) => [c.provider, c.country, c.aggregator, c.count, c.xaf]))
      + section("Annex III — technical partners", ["name", "role", "country", "configured", "active"], b.partners.map((p) => [p.name, p.role, p.country, p.configured, p.active]))
      + section("Repatriation evidence — treasury sweeps", ["sweeps", "marked_sold", "unsold", "customer_xaf", "realized_xaf"], [[b.repatriation.sweeps, b.repatriation.sold, b.repatriation.unsold, b.repatriation.customerXaf, b.repatriation.realizedXaf]])
      + section("Totals", ["inbound_count", "inbound_xaf", "inbound_usd", "credit_count", "credit_xaf", "refunded_count", "refunded_xaf"], [[b.totals.inboundCount, b.totals.inboundXaf, b.totals.inboundUsd, b.totals.creditCount, b.totals.creditXaf, b.totals.refundedCount, b.totals.refundedXaf]]);
  }
  if (body === "ANIF") {
    const a = rep.anif;
    return head
      + section("Suspicious transaction reports filed", ["str_id", "filed_at", "amount_xaf", "payment_ref"], a.strs.map((s) => [s.id, s.at, s.amountXaf, s.ref]))
      + section("Large-transaction register", ["reference", "at", "phone", "name", "amount_xaf"],
          compliance.listCases().filter((c) => c.type === "ctr_threshold" && c.at.startsWith(rep.period)).map((c) => [c.ref ?? c.id, c.at, c.subjectPhone, c.subjectName, c.amountXaf]))
      + section("Summary", ["strs_filed", "ctr_count", "ctr_xaf", "sanctions_hits", "cases_opened", "cases_open", "oldest_escalated_days"], [[a.strsFiled, a.ctrCount, a.ctrXaf, a.sanctionsHits, a.casesOpened, a.casesOpen, a.oldestEscalatedDays]]);
  }
  if (body === "COBAC") {
    const c = rep.cobac;
    return head
      + section("Programme", ["officer", "reporting_entity", "retention_years", "ctr_threshold_xaf", "cdd_threshold_xaf", "sender_day_xaf", "recipient_day_xaf", "sender_hour_count"], [[c.officer, c.reportingEntity, c.retentionYears, c.thresholds.ctrXaf, c.thresholds.cddXaf, c.velocityLimits.senderDayXaf, c.velocityLimits.recipientDayXaf, c.velocityLimits.senderHourCount]])
      + section("Customer due diligence", ["verified", "pending"], [[c.kyc.verified, c.kyc.pending]])
      + section("Cases by type (all time)", ["type", "count"], Object.entries(c.casesByType))
      + section("Dispositions (all time)", ["open", "cleared", "escalated", "reported", "strs_filed"], [[c.dispositions.open, c.dispositions.cleared, c.dispositions.escalated, c.dispositions.reported, c.strsFiled]])
      + section("Record integrity", ["chain_intact", "chain_keyed", "event_count"], [[c.integrityOk, c.chainKeyed, c.eventCount]])
      + section("Year to date", ["payments", "volume_xaf", "cases_opened", "strs_filed"], [[c.ytd.payments, c.ytd.volumeXaf, c.ytd.casesOpened, c.ytd.strsFiled]]);
  }
  const t = rep.tax;
  return head
    + section("Rates (settings — confirm with the accountant)", ["vat_pct", "fee_includes_vat", "turnover_advance_pct", "corporate_rate_pct", "momo_levy_pct", "tax_id"], [[t.rates.vatRatePct, t.rates.feeIncludesVat, t.rates.turnoverAdvancePct, t.rates.corporateRatePct, t.rates.momoLevyPct, t.rates.taxId]])
    + section("Month", ["payments", "volume_xaf", "fee_revenue_xaf", "realized_fx_xaf", "turnover_ex_vat_xaf", "vat_xaf", "acompte_is_xaf", "momo_levy_exposure_xaf"], [[t.payments, t.volumeXaf, t.feeRevenueXaf, t.realizedFxXaf, t.turnoverExVatXaf, t.vatXaf, t.turnoverAdvanceXaf, t.momoLevyXaf]])
    + section("Year to date", ["turnover_ex_vat_xaf", "advances_xaf", "corporate_tax_estimate_xaf"], [[t.ytd.turnoverExVatXaf, t.ytd.advancesXaf, t.ytd.corporateTaxEstimateXaf]])
    + section("By day", ["date", "fee_xaf", "vat_xaf"], t.byDay.map((d) => [d.date, d.feeXaf, d.vatXaf]));
}

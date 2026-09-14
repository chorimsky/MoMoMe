/* ============================================================
   Regulatory filings — one period, every body, from the books.

   The calendar of what is due for the chosen month (BEAC, ANIF, COBAC, DGI), the
   figures each report carries, one-click sectioned CSV per body, and "mark as filed"
   with the body's receipt reference — which lands on the tamper-evident compliance
   chain. Tax figures are estimates from configurable rates (Settings → Tax) and are
   labelled as such: the accountant files, the console prepares.
   ============================================================ */
import { useEffect, useState } from "react";
import type { RegulatoryBody, RegulatoryObligation, RegulatoryReport } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { Card, Grid, Pill, toneColor, toneWash, type Tone } from "../AdminUI.js";

const BODY_LABEL: Record<RegulatoryBody, string> = {
  BEAC: "BEAC — Banque des États de l'Afrique Centrale",
  ANIF: "ANIF — Agence Nationale d'Investigation Financière",
  COBAC: "COBAC — Commission Bancaire de l'Afrique Centrale",
  DGI: "DGI — Direction Générale des Impôts",
};
const STATUS: Record<RegulatoryObligation["status"], { label: string; c: string }> = {
  filed: { label: "Filed", c: "var(--recv)" },
  due: { label: "Due", c: "var(--warn)" },
  overdue: { label: "Overdue", c: "var(--bad)" },
  nothing_to_file: { label: "Nothing to file", c: "var(--ink-3)" },
};
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const BODY_TONE: Record<RegulatoryBody, Tone> = { BEAC: "accent", ANIF: "bad", COBAC: "info", DGI: "warn" };
const BODY_ORDER: RegulatoryBody[] = ["BEAC", "ANIF", "DGI", "COBAC"];
const dueLabel = (o: RegulatoryObligation) => o.dueAt ? new Date(`${o.dueAt}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : o.periodicity === "event" ? "sans délai" : "once a year";

export function RegulatoryFilings({ canFile }: { canFile: boolean }) {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [rep, setRep] = useState<RegulatoryReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = (p = period) => api.adminRegulatory(p).then((r) => { setRep(r); setErr(null); }).catch(() => setErr("Couldn't load the regulatory report."));
  useEffect(() => { void load(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Card title="Regulatory filings"><div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div></Card>;
  if (!rep) return <Card title="Regulatory filings"><div style={{ color: "var(--ink-3)", fontSize: 13 }}>Computing the period…</div></Card>;

  const exportCsv = async (body: RegulatoryBody) => { setBusy(`x:${body}`); await api.regulatoryExportCsv(body, rep.period); setBusy(null); };
  const overdue = rep.obligations.filter((o) => o.status === "overdue").length;
  const due = rep.obligations.filter((o) => o.status === "due").length;
  const t = rep.tax, b = rep.beac, a = rep.anif, c = rep.cobac;

  return (
    <>
      <Card title="Regulatory filings" sub="What each authority is owed for the period — computed from the books, exported per body, and recorded when filed." style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Period{" "}
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ marginLeft: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", font: "inherit", fontSize: 12.5 }}>
              {rep.periods.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
            </select>
          </label>
          <span style={{ fontSize: 12, color: overdue ? "var(--bad)" : due ? "var(--warn)" : "var(--recv)", fontWeight: 700 }}>
            {overdue ? `${overdue} overdue` : due ? `${due} due` : "Nothing outstanding"}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: "auto" }}>Reporting entity: <b>{rep.reportingEntity}</b>{rep.officer ? ` · officer ${rep.officer}` : ""}</span>
        </div>
        {BODY_ORDER.filter((b) => rep.obligations.some((o) => o.body === b)).map((body) => (
          <div key={body} style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r)", marginTop: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "var(--surface-2)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: toneColor(BODY_TONE[body]), background: toneWash(BODY_TONE[body]), padding: "3px 8px", borderRadius: 6 }}>{body}</span>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)", flex: 1, minWidth: 160 }}>{BODY_LABEL[body].split(" — ")[1]}</span>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 10px" }} disabled={busy !== null} onClick={() => exportCsv(body)}>{busy === `x:${body}` ? "…" : `Export ${body} CSV`}</button>
            </div>
            {rep.obligations.filter((o) => o.body === body).map((o) => (
              <ObligationRow key={`${o.body}:${o.kind}`} o={o} canFile={canFile} busy={busy} onFiled={() => load()} setBusy={setBusy} />
            ))}
          </div>
        ))}
      </Card>

      <Grid cols={2} style={{ marginBottom: 16 }}>
        <Card title="BEAC — monthly declaration" sub="Instruction N°002/GR/2026 · Annexes I–III">
          <Kv k="Annex I · funds received" v={`${fmt(b.totals.inboundCount)} receipts · ${fmt(b.totals.inboundXaf)} XAF · ≈ $${fmt(b.totals.inboundUsd)}`} />
          {b.inbound.map((r) => <Kv key={`${r.asset}${r.method}`} k={`  ${r.asset} · ${r.method}`} v={`${fmt(r.count)} · ${r.assetAmount} ${r.asset} · ${fmt(r.xaf)} XAF`} muted />)}
          <Kv k="Annex II · wallet credits" v={`${fmt(b.totals.creditCount)} credits · ${fmt(b.totals.creditXaf)} XAF`} />
          {b.credits.map((r) => <Kv key={`${r.provider}${r.country}${r.aggregator}`} k={`  ${r.provider} · ${r.country} · via ${r.aggregator}`} v={`${fmt(r.count)} · ${fmt(r.xaf)} XAF`} muted />)}
          <Kv k="Refunded (not credited)" v={`${fmt(b.totals.refundedCount)} · ${fmt(b.totals.refundedXaf)} XAF`} />
          <Kv k="Annex III · partners" v={`${b.partners.filter((p) => p.configured).length} configured / ${b.partners.filter((p) => p.active).length} live`} />
          <Kv k="Repatriation evidence" v={`${b.repatriation.sold}/${b.repatriation.sweeps} sweeps marked sold · realized ${fmt(b.repatriation.realizedXaf)} XAF`} tone={b.repatriation.unsold ? "warn" : undefined} />
          {b.repatriation.unsold > 0 && <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 6 }}>{b.repatriation.unsold} sweep(s) without a marked sale — record the sale under Liquidity before filing; the Instruction asks for proof of repatriation.</div>}
        </Card>

        <Card title="DGI — tax position" sub={`Estimates from Settings → Tax (VAT ${t.rates.vatRatePct} % ${t.rates.feeIncludesVat ? "carved out of" : "on top of"} the fee · acompte IS ${t.rates.turnoverAdvancePct} %)${t.rates.taxId ? ` · NIU ${t.rates.taxId}` : " · NIU not set"}`}>
          <Kv k="Payments settled" v={`${fmt(t.payments)} · ${fmt(t.volumeXaf)} XAF delivered`} />
          <Kv k="Platform fees (gross)" v={`${fmt(t.feeRevenueXaf)} XAF`} />
          <Kv k="Realized FX (sweeps sold)" v={`${t.realizedFxXaf >= 0 ? "+" : ""}${fmt(t.realizedFxXaf)} XAF`} />
          <Kv k="Turnover ex-VAT" v={`${fmt(t.turnoverExVatXaf)} XAF`} />
          <Kv k="VAT owed (TVA)" v={`${fmt(t.vatXaf)} XAF`} tone="accent" />
          <Kv k="Acompte IS (monthly advance)" v={`${fmt(t.turnoverAdvanceXaf)} XAF`} tone="accent" />
          <Kv k="Mobile-money levy exposure" v={`${fmt(t.momoLevyXaf)} XAF`} muted />
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>The levy is collected by the operators on transfers/withdrawals — shown for what your payout volume exposes recipients to, not owed by the platform.</div>
          <div style={{ borderTop: "1px solid var(--line-2)", marginTop: 8, paddingTop: 8 }}>
            <Kv k="Year to date · turnover ex-VAT" v={`${fmt(t.ytd.turnoverExVatXaf)} XAF`} />
            <Kv k="Year to date · advances" v={`${fmt(t.ytd.advancesXaf)} XAF`} />
            <Kv k={`Indicative IS at ${t.rates.corporateRatePct} % (before costs)`} v={`${fmt(t.ytd.corporateTaxEstimateXaf)} XAF`} muted />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 8 }}>Estimates. The taxable base assumes the platform fee is the service supplied in Cameroon; the operating entity's status decides what is actually due. Confirm with the accountant before filing.</div>
        </Card>

        <Card title="ANIF — the period's record" sub="Règlement N°02/24 · STRs sans délai · CTR register">
          <Kv k="STRs filed" v={fmt(a.strsFiled)} tone={a.strsFiled ? "accent" : undefined} />
          {a.strs.map((s) => <Kv key={s.id} k={`  ${s.id}`} v={`${fmt(s.amountXaf)} XAF · ${s.ref ?? "—"}`} muted />)}
          <Kv k="CTR register" v={`${fmt(a.ctrCount)} · ${fmt(a.ctrXaf)} XAF`} />
          <Kv k="Sanctions hits" v={fmt(a.sanctionsHits)} tone={a.sanctionsHits ? "bad" : undefined} />
          <Kv k="Cases opened / still open" v={`${fmt(a.casesOpened)} / ${fmt(a.casesOpen)}`} />
          {a.oldestEscalatedDays !== null && <Kv k="Oldest escalated case waiting" v={`${a.oldestEscalatedDays} day(s)`} tone={a.oldestEscalatedDays > 2 ? "bad" : "warn"} />}
        </Card>

        <Card title="COBAC — programme report" sub="R-2023/01 · annual internal AML/CFT control · year to date">
          <Kv k="Compliance officer" v={c.officer ?? "not designated"} tone={c.officer ? undefined : "warn"} />
          <Kv k="Customer due diligence" v={`${fmt(c.kyc.verified)} verified · ${fmt(c.kyc.pending)} pending`} />
          <Kv k="Thresholds in force" v={`CTR ${fmt(c.thresholds.ctrXaf)} · CDD ${fmt(c.thresholds.cddXaf)} XAF`} />
          <Kv k="Velocity limits" v={`${fmt(c.velocityLimits.senderDayXaf)} / ${fmt(c.velocityLimits.recipientDayXaf)} XAF per day · ${c.velocityLimits.senderHourCount} per hour`} />
          <Kv k="Cases (all time)" v={Object.entries(c.casesByType).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"} />
          <Kv k="Dispositions" v={`${c.dispositions.open} open · ${c.dispositions.cleared} cleared · ${c.dispositions.escalated} escalated · ${c.dispositions.reported} reported`} />
          <Kv k="Record integrity" v={`${c.integrityOk ? "chain intact" : "CHAIN BROKEN"} · ${c.chainKeyed ? "keyed" : "unkeyed"} · ${fmt(c.eventCount)} events · ${c.retentionYears}-yr retention`} tone={c.integrityOk ? undefined : "bad"} />
          <Kv k="Year to date" v={`${fmt(c.ytd.payments)} payments · ${fmt(c.ytd.volumeXaf)} XAF · ${c.ytd.casesOpened} cases · ${c.ytd.strsFiled} STRs`} />
        </Card>
      </Grid>

      {rep.filings.length > 0 && (
        <Card title="Filing register" sub="Every report recorded as filed — each pinned to the compliance chain" pad={false} style={{ marginBottom: 16 }}>
          {rep.filings.slice(0, 30).map((f, i) => (
            <div key={f.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "9px 20px", borderTop: i ? "1px solid var(--line-2)" : "none", fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, minWidth: 54 }}>{f.body}</span>
              <span className="mono" style={{ color: "var(--ink-2)" }}>{f.kind}</span>
              <span className="num">{f.period}</span>
              <span style={{ color: "var(--ink-3)" }}>filed {new Date(f.filedAt).toLocaleString("en-GB")} by {f.filedBy}</span>
              {f.reference && <span className="mono" style={{ color: "var(--ink-2)" }}>ref {f.reference}</span>}
              <span className="mono" style={{ color: "var(--ink-3)", marginLeft: "auto" }}>event #{f.eventSeq}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function Kv({ k, v, tone, muted }: { k: string; v: string; tone?: "accent" | "warn" | "bad"; muted?: boolean }) {
  const c = tone === "accent" ? "var(--accent)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : muted ? "var(--ink-3)" : "var(--ink)";
  const sub = k.startsWith("  ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 1.4fr)", gap: 12, padding: sub ? "3px 0 3px 12px" : "6px 0", fontSize: muted ? 12 : 12.5, borderTop: sub ? "none" : "1px solid var(--line-2)", alignItems: "baseline" }}>
      <span style={{ color: muted ? "var(--ink-3)" : "var(--ink-2)" }}>{k.trim()}</span>
      <span className="num" style={{ fontWeight: muted ? 500 : 700, color: c, textAlign: "right", overflowWrap: "anywhere", lineHeight: 1.4 }}>{v}</span>
    </div>
  );
}

function ObligationRow({ o, canFile, busy, onFiled, setBusy }: { o: RegulatoryObligation; canFile: boolean; busy: string | null; onFiled: () => Promise<void>; setBusy: (s: string | null) => void }) {
  const [mode, setMode] = useState(false);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const key = `${o.body}:${o.kind}`;
  const file = async () => {
    setBusy(`f:${key}`); setErr(null);
    try { await api.regulatoryFile(o.body, o.kind, o.period, ref.trim() || undefined); setMode(false); setRef(""); await onFiled(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not record the filing."); }
    finally { setBusy(null); }
  };
  const st = STATUS[o.status];
  const actionable = o.status === "due" || o.status === "overdue";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "6px 16px", padding: "12px 14px", borderTop: "1px solid var(--line-2)", alignItems: "start" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{o.title}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>· {o.periodicity === "annual" ? "annual" : o.periodicity === "event" ? "as it happens" : "monthly"} · due <b className="num" style={{ color: o.status === "overdue" ? "var(--bad)" : "var(--ink-2)", fontWeight: 700 }}>{dueLabel(o)}</b></span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.5 }}>{o.summary}</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.4 }}>{o.basis}</div>
        {o.filing && <div style={{ fontSize: 11.5, color: "var(--recv)", marginTop: 4, fontWeight: 600 }}>Filed {new Date(o.filing.filedAt).toLocaleDateString("en-GB")} by {o.filing.filedBy}{o.filing.reference ? ` · ref ${o.filing.reference}` : ""} · chain event #{o.filing.eventSeq}</div>}
        {mode && (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Receipt / acknowledgement reference (optional)" style={{ flex: 1, minWidth: 200, padding: "7px 10px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" }} />
            <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} disabled={busy !== null} onClick={file}>{busy === `f:${key}` ? "Recording…" : "Confirm filed"}</button>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={() => { setMode(false); setErr(null); }}>Cancel</button>
            {err && <div style={{ fontSize: 11.5, color: "var(--bad)", width: "100%" }}>{err}</div>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flex: "none" }}>
        <Pill status={st.label} tone={o.status === "filed" ? "recv" : o.status === "overdue" ? "bad" : o.status === "due" ? "warn" : "ink"} />
        {canFile && o.status !== "filed" && !mode && (
          <button type="button" className={actionable ? "btn btn-primary" : "btn btn-quiet"} style={{ fontSize: 11.5, padding: "5px 10px", whiteSpace: "nowrap" }} onClick={() => setMode(true)}>{actionable ? "Mark filed" : "Record a filing"}</button>
        )}
      </div>
    </div>
  );
}

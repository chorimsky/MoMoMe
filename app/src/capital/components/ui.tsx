/* ============================================================
   Capital Intelligence component system — every page composes these.
   Hierarchy on screen: strategic signal → metric → underlying data →
   explanation → action. Badges are semantic (tone), never decorative.
   ============================================================ */
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Ccy, Confidence, RiskLevel, Urgency, CapitalType, Source, Calculation, AuditEvent, Freshness } from "@shared/capital.js";
import { CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { money, pct, growth, dateTime } from "../lib/money.js";
import { ago } from "../data/hooks.js";

export type Tone = "good" | "warn" | "bad" | "info" | "accent" | "ink" | "neutral";

/* ---------- badges ---------- */
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className="cap-badge" data-tone={tone === "neutral" ? undefined : tone} title={title}>{children}</span>;
}
const RISK_TONE: Record<RiskLevel, Tone> = { LOW: "good", MEDIUM: "warn", HIGH: "bad", CRITICAL: "bad" };
export const RiskBadge = ({ level }: { level: RiskLevel | Urgency }) => <Badge tone={RISK_TONE[level]}>{level}</Badge>;
const CONF_TONE: Record<Confidence, Tone> = { LOW: "warn", MEDIUM: "info", HIGH: "good" };
export const ConfidenceBadge = ({ level, note }: { level: Confidence; note?: string }) => <Badge tone={CONF_TONE[level]} title={note}>Confidence {level.toLowerCase()}</Badge>;
const CT_TONE: Record<CapitalType, Tone> = { OWN: "accent", POWER: "info", SCALE: "good", STRATEGIC: "ink" };
export const CapitalTypeBadge = ({ type }: { type: CapitalType }) => <Badge tone={CT_TONE[type]}>{type} · {CAPITAL_TYPE_LABEL[type]}</Badge>;
const STATUS_TONE: Record<string, Tone> = {
  COMPLETED: "good", FUNDED: "good", VERIFIED: "good", APPROVED: "good", EXECUTED: "good", SIGNED: "good", ACTIVE: "good", ALLOCATED: "good", TARGET_REACHED: "good", EXECUTING: "info", QUALIFIED: "good", KYC_APPROVED: "good", CLOSED: "ink", Completed: "good",
  REVIEWED: "info", IN_REVIEW: "info", SUBMITTED: "info", ISSUED: "info", SENT: "info", OPEN: "info", FUNDING: "info", FUNDING_IN_PROGRESS: "info", ANALYZING: "info", LEGAL_REVIEW: "info", NEGOTIATING: "info", PENDING: "warn", Pending: "warn", RECEIVED: "warn", PROPOSED: "warn", COUNTERED: "warn", AWAITING_SIGNATURE: "warn", PENDING_FUNDING: "warn", PARTIALLY_FUNDED: "warn", FUNDRAISING_REQUIRED: "warn", IDENTIFIED: "warn", EXPECTED: "warn", DRAFT: "neutral", CREATED: "warn",
  DISMISSED: "ink", REJECTED: "bad", DECLINED: "bad", FAILED: "bad", Failed: "bad", VOID: "bad", CANCELLED: "bad", EXPIRED: "bad", SUPERSEDED: "ink", NOT_STARTED: "neutral", UNQUALIFIED: "neutral", LEAD: "neutral",
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;

/* ---------- metric ---------- */
export function TrendIndicator({ value, label = "vs previous period" }: { value: number | null | undefined; label?: string }) {
  if (value == null) return <span className="cap-sub">no comparison</span>;
  const tone = value > 0 ? "var(--recv)" : value < 0 ? "var(--bad)" : "var(--ink-3)";
  return <span style={{ color: tone, fontWeight: 700 }} aria-label={`${growth(value)} ${label}`}>{value > 0 ? "▲" : value < 0 ? "▼" : "•"} {growth(value)} <span className="cap-sub" style={{ fontWeight: 500 }}>{label}</span></span>;
}
export function Sparkline({ data, h = 28, tone = "var(--ink-3)" }: { data: number[]; h?: number; tone?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((d, i) => `${(i / (data.length - 1 || 1)) * 100},${h - ((d - min) / (max - min || 1)) * (h - 4) - 2}`).join(" ");
  return <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", marginTop: 6 }} aria-hidden="true"><polyline points={pts} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}
export function MetricCard({ label, value, unit, sub, trend, spark, tone, onClick, to, hint }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; trend?: number | null; spark?: number[]; tone?: Tone; onClick?: () => void; to?: string; hint?: string }) {
  const color = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn-ink)" : tone === "good" ? "var(--recv)" : undefined;
  const body = (
    <>
      <div className="k">{label}</div>
      <div className="v num" style={{ color }}>{value}{unit && <span className="u">{unit}</span>}</div>
      {(sub || trend !== undefined) && <div className="s">{trend !== undefined && <TrendIndicator value={trend} />}{sub}</div>}
      {spark && <Sparkline data={spark} />}
    </>
  );
  const cls = `cap-card cap-metric${onClick || to ? " clickable" : ""}`;
  if (to) return <Link to={to} className={cls} style={{ textDecoration: "none", display: "block" }} title={hint}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick} style={{ textAlign: "left", font: "inherit", width: "100%" }} title={hint}>{body}</button>;
  return <div className={cls} title={hint}>{body}</div>;
}
export const FinancialMetric = ({ label, amount, ccy, ...rest }: { label: string; amount: number | null | undefined; ccy: Ccy } & Omit<Parameters<typeof MetricCard>[0], "label" | "value">) => <MetricCard label={label} value={money(amount, ccy, { compact: true })} hint={money(amount, ccy)} {...rest} />;

/* ---------- layout ---------- */
export function Card({ title, sub, action, children, pad = true, style }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode; pad?: boolean; style?: CSSProperties }) {
  return (
    <section className="cap-card" style={style}>
      {(title || action) && <div className="cap-card-h"><div>{title && <h2>{title}</h2>}{sub && <div className="cap-sub" style={{ marginTop: 2 }}>{sub}</div>}</div>{action}</div>}
      <div className={pad ? "cap-card-b" : ""} style={!title && pad ? { paddingTop: 16 } : undefined}>{children}</div>
    </section>
  );
}
export const Grid = ({ cols, children, style }: { cols: number; children: ReactNode; style?: CSSProperties }) => <div className="cap-grid" data-cols={cols} style={{ ["--cols" as string]: String(cols), ...style } as CSSProperties}>{children}</div>;
export function PageHeader({ title, sub, action, freshness }: { title: string; sub?: ReactNode; action?: ReactNode; freshness?: Freshness | null }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      <div><h1>{title}</h1>{sub && <p className="cap-sub" style={{ marginTop: 4, maxWidth: 720 }}>{sub}</p>}{freshness && <FreshnessLine f={freshness} />}</div>
      {action && <div className="cap-toolbar">{action}</div>}
    </div>
  );
}
export function FreshnessLine({ f }: { f: Freshness }) {
  const stale = Date.now() - Date.parse(f.dataAsOf) > 6 * 3600_000;
  return <div className="cap-sub" style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><span>Data updated {ago(f.dataAsOf)}</span><span>·</span><span>{f.sampleSize} records</span>{stale && <Badge tone="warn">Stale data</Badge>}{f.sampleSize < 10 && <Badge tone="warn">Small sample</Badge>}{f.note && <span>· {f.note}</span>}</div>;
}
export const KV = ({ k, v }: { k: ReactNode; v: ReactNode }) => <div className="cap-kv"><span>{k}</span><span>{v}</span></div>;
export function Tabs({ items, base }: { items: Array<{ to: string; label: string; end?: boolean }>; base?: string }) {
  const loc = useLocation();
  return <nav className="cap-tabs" aria-label="Sections">{items.map((t) => { const full = base ? `${base}${t.to}` : t.to; const active = t.end ? loc.pathname === full : loc.pathname.startsWith(full); return <Link key={t.to} to={full} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{t.label}</Link>; })}</nav>;
}
export function Seg<T extends string | number>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return <div className="cap-seg" role="group">{options.map((o) => <button key={String(o)} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>{labels?.[o] ?? String(o)}</button>)}</div>;
}
export function Steps({ steps, current, labels }: { steps: readonly string[]; current: string; labels?: (s: string) => string }) {
  const idx = steps.indexOf(current);
  return <div className="cap-steps" aria-label={`Stage ${current}`}>{steps.map((s, i) => <span key={s} data-on={i === idx} data-done={i < idx}>{labels ? labels(s) : s.replace(/_/g, " ")}</span>)}</div>;
}
export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const id = useId();
  return (
    <div className="cap-modal-bg" onClick={onClose} role="presentation">
      <div className="cap-modal" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="cap-card-h" style={{ alignItems: "center" }}><h2 id={id}>{title}</h2><button type="button" className="cap-btn quiet" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="cap-card-b">{children}</div>
      </div>
    </div>
  );
}
export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="cap-field"><span>{label}</span>{children}</label>;
export function ErrorLine({ error }: { error: string | null }) { return error ? <div role="alert" className="cap-banner" data-tone="bad" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div> : null; }

/* ---------- data states ---------- */
export function DataState({ loading, error, forbidden, empty, emptyHint, onRetry, rows = 3, children }: { loading: boolean; error: string | null; forbidden?: boolean; empty?: boolean; emptyHint?: ReactNode; onRetry?: () => void; rows?: number; children: ReactNode }) {
  if (forbidden) return <div className="cap-state" role="status"><b>You don't have access to this view.</b><br />Your role can't read this data. Ask an administrator if you need it.</div>;
  if (error) return <div className="cap-state" role="alert"><b>Couldn't load this data.</b><br />{error}{onRetry && <div style={{ marginTop: 10 }}><button type="button" className="cap-btn" onClick={onRetry}>Retry</button></div>}</div>;
  if (loading) return <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 10, padding: 8 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="cap-skel" style={{ height: 18 + (i % 2) * 8, width: `${90 - i * 12}%` }} />)}</div>;
  if (empty) return <div className="cap-state" role="status"><b>Nothing here yet.</b><br />{emptyHint ?? "There is no data for the current filters."}</div>;
  return <>{children}</>;
}
export function PartialBanner({ text }: { text: string }) { return <div className="cap-banner" data-tone="warn">⚠ <span><b>Partial data.</b> {text}</span></div>; }

/* ---------- data table ---------- */
export interface Column<T> { key: string; label: string; right?: boolean; render: (row: T) => ReactNode; sort?: (row: T) => number | string; width?: number }
export function DataTable<T>({ rows, columns, rowKey, onRow, selectedKey, empty, pageSize = 25, stack = true, initialSort }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; selectedKey?: string | null; empty?: ReactNode; pageSize?: number; stack?: boolean; initialSort?: { key: string; dir: "asc" | "desc" } }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key); if (!col?.sort) return rows;
    const s = col.sort;
    return [...rows].sort((a, b) => { const x = s(a), y = s(b); const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)); return sort.dir === "asc" ? c : -c; });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const view = sorted.slice(page * pageSize, (page + 1) * pageSize);
  if (rows.length === 0) return <div className="cap-state">{empty ?? "No rows."}</div>;
  return (
    <div className="cap-tablewrap">
      <table className={`cap-table${stack ? " stack" : ""}`} data-cols={columns.length}>
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.right ? "r" : ""} style={c.width ? { width: c.width } : undefined} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>{c.sort ? <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "desc" ? "asc" : "desc" }))}>{c.label}{sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</button> : c.label}</th>)}</tr></thead>
        <tbody>{view.map((r) => { const k = rowKey(r); return <tr key={k} className={`${onRow ? "clickable" : ""}${selectedKey === k ? " selected" : ""}`} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>{columns.map((c) => <td key={c.key} className={c.right ? "r" : ""} data-l={c.label}>{c.render(r)}</td>)}</tr>; })}</tbody>
      </table>
      {pages > 1 && <div className="cap-toolbar" style={{ justifyContent: "flex-end", padding: "8px 0" }}><span className="cap-sub">{page * pageSize + 1}–{Math.min(sorted.length, (page + 1) * pageSize)} of {sorted.length}</span><button type="button" className="cap-btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><button type="button" className="cap-btn sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button></div>}
    </div>
  );
}
export function exportCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- traceability ---------- */
const SOURCE_HREF: Record<Source["kind"], string> = { transactions: "/capital-intelligence/transactions", ledger: "/admin", liquidity: "/capital-intelligence/liquidity", treasury: "/admin", pricing: "/capital-intelligence/revenue", forecast: "/capital-intelligence/forecasts", requirement: "/capital-intelligence/capital-requirements", investors: "/investors", capital_ledger: "/capital", settings: "/capital-intelligence/concentration", recommendation: "/capital-intelligence/recommendations" };
export function SourceTrace({ sources, compact }: { sources: Source[]; compact?: boolean }) {
  if (!sources.length) return null;
  const list = <ul style={{ margin: 0, padding: "0 0 0 16px", display: "grid", gap: 3, fontSize: 12.5 }}>{sources.map((s, i) => <li key={`${s.ref}-${i}`}><Link to={s.kind === "requirement" && s.ref.startsWith("CR-") ? `/capital-intelligence/capital-requirements/${s.ref}` : s.kind === "capital_ledger" ? `/capital/${({ OWN: "equity", POWER: "liquidity", SCALE: "growth", STRATEGIC: "strategic" } as Record<string, string>)[s.ref.split(":")[1]] ?? ""}` : SOURCE_HREF[s.kind]}>{s.label}</Link> <span className="cap-sub">({s.kind.replace(/_/g, " ")} · {s.ref})</span></li>)}</ul>;
  if (compact) return <details className="cap-trace"><summary><span>Sources ({sources.length})</span><span>▾</span></summary><div>{list}</div></details>;
  return <div><div className="overline" style={{ marginBottom: 6 }}>Sources</div>{list}</div>;
}
export function CalculationTrace({ calc, open }: { calc: Calculation; open?: boolean }) {
  return (
    <details className="cap-trace" open={open}>
      <summary><span>Calculation · {calc.id}</span><span>▾</span></summary>
      <div>
        <div className="cap-sub" style={{ marginBottom: 8, fontStyle: "italic" }}>{calc.formula}</div>
        {/* Signs are shown only for additive calculations (one with a subtracted step) — a
            descriptive step like "daily mean" reads wrong with a leading plus. */}
        {calc.steps.length > 0 && (() => { const additive = calc.steps.some((s) => s.value < 0); return <table className="cap-table" style={{ fontSize: 12.5 }}><tbody>{calc.steps.map((s, i) => <tr key={i}><td>{s.label}{s.note && <div className="cap-sub">{s.note}</div>}</td><td className="r num">{s.ccy ? money(s.value, s.ccy, { sign: additive }) : s.value}</td></tr>)}<tr><td><b>Result</b></td><td className="r num"><b>{calc.ccy ? money(calc.result, calc.ccy, { sign: additive }) : calc.result}</b></td></tr></tbody></table>; })()}
      </div>
    </details>
  );
}
export function AuditTimeline({ events, limit = 30 }: { events: AuditEvent[]; limit?: number }) {
  if (!events.length) return <div className="cap-sub">No history yet.</div>;
  const list = [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return <ol className="cap-timeline">{list.map((e, i) => <li key={i} data-tone={/approved|verified|executed|funded|signed/i.test(e.action) ? "good" : /reject|dismiss|void|fail/i.test(e.action) ? "bad" : undefined}><div><b>{e.action}</b>{e.note && <span className="cap-sub"> — {e.note}</span>}</div><div className="cap-sub">{e.actor} · {dateTime(e.at)}</div></li>)}</ol>;
}

/* ---------- financial gauges ---------- */
export function LiquidityMeter({ available, required, ccy = "XAF" }: { available: number; required: number; ccy?: Ccy }) {
  const cov = required > 0 ? available / required : null;
  const p = cov == null ? 0 : Math.min(100, cov * 100);
  const tone = cov == null ? "var(--ink-3)" : cov >= 1.2 ? "var(--recv)" : cov >= 1 ? "var(--warn)" : "var(--bad)";
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label="Liquidity coverage">
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span>Available <b className="num">{money(available, ccy, { compact: true })}</b></span><span>Required <b className="num">{money(required, ccy, { compact: true })}</b></span></div>
      <div style={{ height: 10, borderRadius: 5, background: "var(--surface-2)", overflow: "hidden", position: "relative" }}><div style={{ width: `${p}%`, height: "100%", background: tone }} /><div style={{ position: "absolute", left: "100%", top: 0, bottom: 0, width: 2, background: "var(--ink)", transform: "translateX(-2px)" }} /></div>
      <div className="cap-sub" style={{ marginTop: 6 }}>Coverage {cov == null ? "—" : `${cov.toFixed(2)}×`} · {cov == null ? "no requirement" : cov >= 1 ? "requirement covered" : `gap ${money(required - available, ccy)}`}</div>
    </div>
  );
}
export function CapitalGapIndicator({ requirement, available, ccy, urgency }: { requirement: number; available: number; ccy: Ccy; urgency: Urgency }) {
  const gap = Math.max(0, requirement - available);
  return (
    <div>
      <KV k="Current requirement" v={money(requirement, ccy)} /><KV k="Available capital" v={money(available, ccy)} />
      <KV k="Funding gap" v={<span style={{ color: gap > 0 ? "var(--bad)" : "var(--recv)" }}>{money(gap, ccy)}</span>} /><KV k="Funding urgency" v={<RiskBadge level={urgency} />} />
    </div>
  );
}
export const Pct = ({ v }: { v: number | null | undefined }) => <span className="num">{pct(v)}</span>;

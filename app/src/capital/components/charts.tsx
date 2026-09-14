/* ============================================================
   Charts — small, dependency-free SVG. Each chart answers one question and
   carries legend, units, axis labels, tooltips (title) and an accessible
   summary. Colours are the semantic tokens; no gradients, no decoration.
   ============================================================ */
import { useId, useState, type ReactNode } from "react";
import { compact } from "../lib/money.js";

export function ChartContainer({ title, question, legend, unit, children, empty, height = 220 }: { title: string; question?: string; legend?: Array<{ label: string; color: string; dashed?: boolean }>; unit?: string; children: ReactNode; empty?: boolean; height?: number }) {
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>{question && <div className="cap-sub">{question}</div>}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>{legend?.map((l) => <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden style={{ width: 14, height: 0, borderTop: `3px ${l.dashed ? "dashed" : "solid"} ${l.color}` }} />{l.label}</span>)}{unit && <span className="cap-sub">{unit}</span>}</div>
      </figcaption>
      {empty ? <div className="cap-state" style={{ height, display: "grid", placeItems: "center" }}>No data for this period.</div> : <div style={{ height }}>{children}</div>}
    </figure>
  );
}

type Pt = { x: string; y: number };
const W = 600, H = 200, PL = 46, PR = 8, PT = 10, PB = 26;
function scale(series: number[][], h = H) {
  const all = series.flat(); const max = Math.max(1, ...all), min = Math.min(0, ...all);
  return { max, min, y: (v: number) => PT + (h - PT - PB) * (1 - (v - min) / (max - min || 1)) };
}
const xAt = (i: number, n: number) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
function Axes({ max, min, y, labels }: { max: number; min: number; y: (v: number) => number; labels: string[] }) {
  const ticks = [min, min + (max - min) / 2, max];
  const n = labels.length; const li = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return <g fontSize="10" fill="var(--ink-3)">{ticks.map((t) => <g key={t}><line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 3" /><text x={PL - 6} y={y(t) + 3} textAnchor="end">{compact(t)}</text></g>)}{li.map((i) => <text key={i} x={xAt(i, n)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{labels[i]?.slice(5)}</text>)}</g>;
}
/** Line chart with an optional confidence band (lower/upper) and any number of series. */
export function LineChart({ labels, series, band, unit = "" }: { labels: string[]; series: Array<{ name: string; values: number[]; color: string; dashed?: boolean }>; band?: { lower: number[]; upper: number[]; color?: string }; unit?: string }) {
  const id = useId(); const [hover, setHover] = useState<number | null>(null);
  const s = scale([...series.map((x) => x.values), ...(band ? [band.lower, band.upper] : [])]);
  const n = labels.length; if (!n) return null;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${xAt(i, n)},${s.y(v)}`).join(" ");
  const bandPath = band ? `${band.upper.map((v, i) => `${i ? "L" : "M"}${xAt(i, n)},${s.y(v)}`).join(" ")} ${[...band.lower].reverse().map((v, i) => `L${xAt(n - 1 - i, n)},${s.y(v)}`).join(" ")} Z` : "";
  const desc = series.map((x) => `${x.name}: from ${compact(x.values[0] ?? 0)} to ${compact(x.values[n - 1] ?? 0)}${unit}`).join("; ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }} role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)} onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PL) / (W - PL - PR)) * (n - 1))))); }}>
      <title id={`${id}-t`}>{desc}</title>
      <Axes {...s} labels={labels} />
      {band && <path d={bandPath} fill={band.color ?? "var(--info)"} opacity={0.12} />}
      {series.map((x) => <path key={x.name} d={path(x.values)} fill="none" stroke={x.color} strokeWidth={2} strokeDasharray={x.dashed ? "5 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
      {hover != null && <g><line x1={xAt(hover, n)} x2={xAt(hover, n)} y1={PT} y2={H - PB} stroke="var(--ink-3)" strokeDasharray="3 3" />{series.map((x) => <circle key={x.name} cx={xAt(hover, n)} cy={s.y(x.values[hover] ?? 0)} r={3.5} fill={x.color} />)}<foreignObject x={Math.min(W - 170, Math.max(PL, xAt(hover, n) + 8))} y={PT} width={160} height={20 + series.length * 16}><div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px", fontSize: 11, boxShadow: "var(--shadow)" }}><div style={{ color: "var(--ink-3)" }}>{labels[hover]}</div>{series.map((x) => <div key={x.name}><span style={{ color: x.color }}>●</span> {x.name}: <b className="num">{compact(x.values[hover] ?? 0)}{unit}</b></div>)}{band && <div className="cap-sub">band {compact(band.lower[hover] ?? 0)}–{compact(band.upper[hover] ?? 0)}</div>}</div></foreignObject></g>}
    </svg>
  );
}
/** Horizontal bars — comparisons across categories (routes, countries, capital types). */
export function BarChart({ rows, unit = "", color = "var(--ink-2)", max }: { rows: Array<{ label: string; value: number; color?: string; sub?: string }>; unit?: string; color?: string; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <div className="cap-state">No data.</div>;
  return (
    <div role="list" style={{ display: "grid", gap: 7 }}>
      {rows.map((r) => <div key={r.label} role="listitem" style={{ display: "grid", gridTemplateColumns: "minmax(80px, 34%) 1fr auto", gap: 8, alignItems: "center", fontSize: 12.5 }} title={`${r.label}: ${r.value}${unit}`}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}{r.sub && <span className="cap-sub"> · {r.sub}</span>}</span><div style={{ height: 10, background: "var(--surface-2)", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${(Math.abs(r.value) / m) * 100}%`, height: "100%", background: r.color ?? (r.value < 0 ? "var(--bad)" : color) }} /></div><span className="num" style={{ minWidth: 64, textAlign: "right" }}>{compact(r.value)}{unit}</span></div>)}
    </div>
  );
}
/** Stacked columns per period (e.g. inflow vs outflow). */
export function ColumnChart({ labels, series, unit = "" }: { labels: string[]; series: Array<{ name: string; values: number[]; color: string }>; unit?: string }) {
  const id = useId(); const n = labels.length; if (!n) return null;
  const s = scale(series.map((x) => x.values));
  const bw = Math.max(2, ((W - PL - PR) / n) * 0.7 / series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }} role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>{series.map((x) => `${x.name} total ${compact(x.values.reduce((a, b) => a + b, 0))}${unit}`).join("; ")}</title>
      <Axes {...s} labels={labels} />
      {series.map((x, si) => x.values.map((v, i) => <rect key={`${si}-${i}`} x={xAt(i, n) - (bw * series.length) / 2 + si * bw} y={s.y(Math.max(0, v))} width={bw} height={Math.abs(s.y(0) - s.y(v))} fill={x.color}><title>{labels[i]} · {x.name}: {compact(v)}{unit}</title></rect>))}
    </svg>
  );
}
/** Funnel — each stage as a proportion of the first. */
export function Funnel({ stages, unit = "" }: { stages: Array<{ label: string; value: number; sub?: string }>; unit?: string }) {
  const top = Math.max(1, stages[0]?.value ?? 1);
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
      {stages.map((s, i) => <li key={s.label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 30%) 1fr", gap: 10, alignItems: "center", fontSize: 12.5 }}><span>{s.label}{s.sub && <div className="cap-sub">{s.sub}</div>}</span><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: `${Math.max(3, (s.value / top) * 100)}%`, height: 18, background: i === stages.length - 1 ? "var(--recv)" : "var(--info)", opacity: 0.45 + (i / Math.max(1, stages.length - 1)) * 0.55, borderRadius: 4 }} /><span className="num">{compact(s.value)}{unit}</span>{i > 0 && stages[i - 1].value > 0 && <span className="cap-sub">{Math.round((s.value / stages[i - 1].value) * 100)}% of prior</span>}</div></li>)}
    </ol>
  );
}
/** Share ring for concentration — one dimension at a time. */
export function ShareBar({ rows }: { rows: Array<{ label: string; sharePct: number; threshold: number; tone: string }> }) {
  return <div style={{ display: "grid", gap: 8 }}>{rows.map((r) => <div key={r.label} style={{ fontSize: 12.5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span>{r.label}</span><span className="num">{r.sharePct}% <span className="cap-sub">/ {r.threshold}%</span></span></div><div style={{ position: "relative", height: 8, background: "var(--surface-2)", borderRadius: 4, marginTop: 3 }}><div style={{ width: `${Math.min(100, r.sharePct)}%`, height: "100%", background: r.tone, borderRadius: 4 }} /><div style={{ position: "absolute", left: `${Math.min(100, r.threshold)}%`, top: -2, bottom: -2, width: 2, background: "var(--ink)" }} title={`Threshold ${r.threshold}%`} /></div></div>)}</div>;
}

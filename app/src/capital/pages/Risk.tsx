/* ============================================================
   /capital-intelligence/efficiency · /concentration · /risk
   ============================================================ */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { EfficiencyRow, ConcentrationDim, RiskItem } from "@shared/capital.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { can } from "../data/permissions.js";
import { money, pct, ratio, titleCase } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, MetricCard, RiskBadge, SourceTrace, Seg, Field, ErrorLine, Badge, KV, type Column } from "../components/ui.js";
import { ChartContainer, BarChart, ShareBar } from "../components/charts.js";

export function EfficiencyPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.efficiency(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const [dim, setDim] = useState<"byCapitalType" | "byRail" | "byRoute" | "byCountry">("byCapitalType");
  const cols: Column<EfficiencyRow>[] = [
    { key: "label", label: "Segment", render: (x) => x.label, sort: (x) => x.label },
    { key: "capital", label: "Capital", right: true, render: (x) => money(x.capital, "XAF"), sort: (x) => x.capital },
    { key: "vol", label: "Volume supported", right: true, render: (x) => money(x.volumeSupported, "XAF"), sort: (x) => x.volumeSupported },
    { key: "rev", label: "Revenue", right: true, render: (x) => money(x.revenue, "XAF"), sort: (x) => x.revenue },
    { key: "turn", label: "Turnover", right: true, render: (x) => ratio(x.turnover), sort: (x) => x.turnover ?? -1 },
    { key: "rpc", label: "Revenue / capital", right: true, render: (x) => ratio(x.revenuePerCapital, 3), sort: (x) => x.revenuePerCapital ?? -1 },
    { key: "util", label: "Utilisation", right: true, render: (x) => pct(x.utilizationPct), sort: (x) => x.utilizationPct ?? -1 },
    { key: "idle", label: "Idle", right: true, render: (x) => money(x.idle, "XAF"), sort: (x) => x.idle },
    { key: "ratio", label: "Efficiency ratio", right: true, render: (x) => ratio(x.ratio), sort: (x) => x.ratio ?? -1 },
  ];
  return (
    <div>
      <PageHeader title="Capital Efficiency" sub="Turnover, revenue per unit of capital, utilisation and idle balances — by capital type, rail, route and country. Capital ledgers are converted to XAF at today's rate for comparison only." freshness={d?.freshness} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid cols={5}>
              <MetricCard label="Capital turnover" value={ratio(d.totals.turnover)} sub="volume ÷ available liquidity" />
              <MetricCard label="Revenue per capital" value={ratio(d.totals.revenuePerCapital, 3)} />
              <MetricCard label="Utilisation" value={pct(d.totals.utilizationPct)} />
              <MetricCard label="Idle capital" value={money(d.totals.idle, "XAF", { compact: true })} tone={d.totals.idle > 0 ? "warn" : undefined} />
              <MetricCard label="Efficiency ratio" value={ratio(d.totals.ratio)} />
            </Grid>
            <Grid cols={4}>
              <Card title="Most efficient"><b>{d.findings.mostEfficient ?? "—"}</b></Card>
              <Card title="Least efficient"><b>{d.findings.leastEfficient ?? "—"}</b></Card>
              <Card title="Underutilised">{d.findings.underutilized.length ? d.findings.underutilized.map((u) => <div key={u}><Badge tone="warn">{u}</Badge></div>) : <span className="cap-sub">None below 30%.</span>}</Card>
              <Card title="Bottlenecks">{d.findings.bottlenecks.length ? d.findings.bottlenecks.map((u) => <div key={u}><Badge tone="bad">{u}</Badge></div>) : <span className="cap-sub">None above 90%.</span>}</Card>
            </Grid>
            <Card title="Comparison" action={<Seg options={["byCapitalType", "byRail", "byRoute", "byCountry"] as const} value={dim} onChange={setDim} labels={{ byCapitalType: "Capital type", byRail: "Rail", byRoute: "Route", byCountry: "Country" }} />} pad={false}><DataTable rows={d[dim]} columns={cols} rowKey={(x) => x.key} stack={false} initialSort={{ key: "ratio", dir: "desc" }} empty="Nothing to compare in this period." /></Card>
            <Card title="Turnover by segment"><ChartContainer title="Capital turnover" question="Where does each unit of capital do the most work?" unit="×" height={160}><BarChart rows={d[dim].map((x) => ({ label: x.label, value: x.turnover ?? 0 }))} unit="×" /></ChartContainer></Card>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

const DIMS: ConcentrationDim[] = ["investor", "country", "currency", "rail", "provider", "capitalType"];
export function ConcentrationPage() {
  const { intel } = useFilters();
  const { role } = useAdminUser();
  const r = useResource(() => capitalApi.concentration(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const [editing, setEditing] = useState(false);
  const [th, setTh] = useState<Record<ConcentrationDim, number> | null>(null);
  const save = useAction(() => capitalApi.setThresholds(th ?? {}), () => { setEditing(false); r.refresh(); });
  const tone = (s: string) => (s === "CRITICAL" || s === "HIGH" ? "var(--bad)" : s === "MEDIUM" ? "var(--warn)" : "var(--recv)");
  return (
    <div>
      <PageHeader title="Capital Concentration" sub="Exposure by investor, country, currency, rail, provider and capital type against configurable thresholds." freshness={d?.freshness} action={can(role, "thresholds:set") && d && <button type="button" className="cap-btn" onClick={() => { setTh({ ...d.thresholds }); setEditing((v) => !v); }}>{editing ? "Cancel" : "Set thresholds"}</button>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            {editing && th && (
              <Card title="Thresholds (% share)" sub="A segment at or above its threshold is CRITICAL; 85% of it is HIGH; 60% is MEDIUM.">
                <Grid cols={6}>{DIMS.map((k) => <Field key={k} label={titleCase(k)}><input className="cap-input" type="number" min={1} max={100} value={th[k]} onChange={(e) => setTh({ ...th, [k]: Number(e.target.value) })} /></Field>)}</Grid>
                <div style={{ marginTop: 10 }}><button type="button" className="cap-btn primary" disabled={save.busy} onClick={() => save.run()}>Save thresholds</button></div><ErrorLine error={save.error} />
              </Card>
            )}
            <Grid cols={3}>
              {DIMS.map((dim) => { const rows = d.rows.filter((x) => x.dim === dim); return (
                <Card key={dim} title={titleCase(dim)} sub={`threshold ${d.thresholds[dim]}%`}>
                  {rows.length ? <ShareBar rows={rows.map((x) => ({ label: x.label, sharePct: x.sharePct, threshold: x.thresholdPct, tone: tone(x.status) }))} /> : <div className="cap-sub">No exposure recorded.</div>}
                </Card>
              ); })}
            </Grid>
            <Card title="All exposures" pad={false}>
              <DataTable rows={d.rows} columns={[
                { key: "dim", label: "Dimension", render: (x) => titleCase(x.dim), sort: (x) => x.dim },
                { key: "label", label: "Segment", render: (x) => x.label, sort: (x) => x.label },
                { key: "exp", label: "Exposure", right: true, render: (x) => money(x.exposure, x.ccy), sort: (x) => x.exposure },
                { key: "share", label: "Concentration", right: true, render: (x) => pct(x.sharePct), sort: (x) => x.sharePct },
                { key: "th", label: "Threshold", right: true, render: (x) => pct(x.thresholdPct, 0) },
                { key: "status", label: "Risk status", render: (x) => <RiskBadge level={x.status} />, sort: (x) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(x.status) },
              ]} rowKey={(x) => `${x.dim}:${x.key}`} stack={false} initialSort={{ key: "share", dir: "desc" }} empty="No exposure yet." />
            </Card>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

const CAT_LABEL: Record<RiskItem["category"], string> = { liquidity: "Liquidity risk", capital_concentration: "Capital concentration", forecast: "Forecast risk", settlement: "Settlement risk", operational: "Operational risk", investor_concentration: "Investor concentration", data_quality: "Data quality" };
const CAT_HREF: Record<RiskItem["category"], string> = { liquidity: "/capital-intelligence/liquidity", capital_concentration: "/capital-intelligence/concentration", forecast: "/capital-intelligence/forecasts", settlement: "/capital-intelligence/routes", operational: "/capital-intelligence/transactions", investor_concentration: "/capital-intelligence/concentration", data_quality: "/capital-intelligence" };
export function RiskPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.risk(intel), [JSON.stringify(intel)]);
  const d = r.data;
  return (
    <div>
      <PageHeader title="Risk Center" sub="Every risk with its level, score, drivers, affected area, trend and the action the engine suggests. Suggestions are for management to weigh — nothing here acts on its own." freshness={d?.freshness} action={d && <span className="cap-toolbar"><span className="cap-sub">Overall</span><RiskBadge level={d.overall} /></span>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Card title="Risk scores"><ChartContainer title="Score by category" question="Which risk deserves attention first?" unit="/100" height={190}><BarChart rows={d.items.map((i) => ({ label: CAT_LABEL[i.category], value: i.score, color: i.level === "CRITICAL" || i.level === "HIGH" ? "var(--bad)" : i.level === "MEDIUM" ? "var(--warn)" : "var(--recv)" }))} max={100} /></ChartContainer></Card>
            <Grid cols={2}>
              {d.items.map((i) => (
                <Card key={i.id} title={CAT_LABEL[i.category]} sub={<span>Affects {i.affectedArea}</span>} action={<span className="cap-toolbar"><RiskBadge level={i.level} /><Badge tone={i.trend === "worsening" ? "bad" : i.trend === "improving" ? "good" : "neutral"}>{i.trend}</Badge></span>}>
                  <KV k="Risk score" v={`${i.score} / 100`} />
                  <div style={{ margin: "8px 0" }}><div className="overline">Drivers</div><ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5 }}>{i.drivers.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  <div className="overline">Recommended action</div><p style={{ fontSize: 13, marginTop: 4 }}>{i.recommendedAction}</p>
                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Link to={CAT_HREF[i.category]} className="cap-btn sm">Open area</Link><SourceTrace sources={i.sources} compact /></div>
                </Card>
              ))}
            </Grid>
          </div>
        )}
      </DataState>
    </div>
  );
}

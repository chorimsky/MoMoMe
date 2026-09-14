/* ============================================================
   /capital-intelligence/forecasts — every forecast with expected / lower /
   upper / confidence and its method. /scenarios — Conservative / Base /
   Aggressive comparison plus a custom "what if".
   ============================================================ */
import { useState } from "react";
import type { Forecast, ForecastMetric, Horizon, ScenarioInputs } from "@shared/capital.js";
import { HORIZONS } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { useResource } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { money, count, pct } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, ConfidenceBadge, SourceTrace, Seg, Field, KV, CalculationTrace } from "../components/ui.js";
import { ChartContainer, LineChart, BarChart } from "../components/charts.js";

const METRIC_LABEL: Record<ForecastMetric, string> = { volume: "Transaction volume", count: "Transaction count", revenue: "Revenue", margin: "Margin", liquidityRequirement: "Liquidity requirement", capitalRequirement: "Capital requirement", runwayDays: "Float runway" };
const fmtMetric = (f: Forecast, v: number) => (f.metric === "count" ? count(v) : f.metric === "runwayDays" ? `${count(v)} days` : money(v, f.ccy ?? "XAF", { compact: true }));

export function ForecastsPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.forecasts(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const [h, setH] = useState<Horizon>(90);
  const vol = d?.forecasts.find((f) => f.metric === "volume");
  return (
    <div>
      <PageHeader title="Forecasting Center" sub="Statistical projections of the settlement book. Every figure carries a lower and upper bound and a confidence that falls with the sample size — the band is the message." freshness={d?.freshness} action={<Seg options={HORIZONS} value={h} onChange={setH} labels={{ 30: "30 days", 90: "90 days", 180: "180 days", 365: "365 days" }} />} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            {vol && vol.basis.observations < 10 && <div className="cap-banner" data-tone="warn">⚠ Only {vol.basis.observations} active days in the basis — treat every band here as indicative.</div>}
            <Grid cols={4}>
              {d.forecasts.map((f) => { const p = f.horizons[h]; return (
                <div key={f.id} className="cap-card cap-metric">
                  <div className="k">{METRIC_LABEL[f.metric]}</div>
                  <div className="v num">{fmtMetric(f, p.expected)}</div>
                  <div className="s"><span className="num">{fmtMetric(f, p.lower)} – {fmtMetric(f, p.upper)}</span></div>
                  <div style={{ marginTop: 8 }}><ConfidenceBadge level={p.confidence} note={`${f.basis.observations} active days`} /></div>
                </div>
              ); })}
            </Grid>
            {vol && (
              <Card title="Volume projection" sub={vol.method}>
                <ChartContainer title="Cumulative expected volume (90 days)" question="How much volume should the float be sized for, and how wide is the uncertainty?" legend={[{ label: "Expected", color: "var(--ink)" }, { label: "80% band", color: "var(--info)" }]} unit="XAF" empty={!vol.series.length}><LineChart labels={vol.series.map((p) => p.date)} series={[{ name: "Expected", values: vol.series.map((p) => p.expected), color: "var(--ink)" }]} band={{ lower: vol.series.map((p) => p.lower), upper: vol.series.map((p) => p.upper) }} /></ChartContainer>
                <div className="cap-split" style={{ marginTop: 12 }}>
                  <div><KV k="Basis" v={`${vol.basis.observations} active of ${vol.basis.days} days`} /><KV k="Daily mean" v={money(vol.basis.dailyMean, "XAF")} /><KV k="Daily σ" v={money(vol.basis.dailyStdev, "XAF")} /><KV k="Trend / day" v={money(vol.basis.trendPerDay, "XAF", { sign: true })} /></div>
                  <ChartContainer title="Expected by horizon" unit="XAF" height={130}><BarChart rows={HORIZONS.map((x) => ({ label: `${x} days`, value: vol.horizons[x].expected }))} /></ChartContainer>
                </div>
              </Card>
            )}
            <Card title="All forecasts" sub="Expected · lower · upper · confidence for every horizon." pad={false}>
              <div className="cap-tablewrap"><table className="cap-table" data-cols={6}><thead><tr><th>Forecast</th>{HORIZONS.map((x) => <th key={x} className="r">{x} d</th>)}<th>Method</th></tr></thead><tbody>{d.forecasts.map((f) => <tr key={f.id}><td><b>{METRIC_LABEL[f.metric]}</b><div className="cap-sub">{f.id}</div></td>{HORIZONS.map((x) => { const p = f.horizons[x]; return <td key={x} className="r num"><div>{fmtMetric(f, p.expected)}</div><div className="cap-sub">{fmtMetric(f, p.lower)}–{fmtMetric(f, p.upper)}</div><ConfidenceBadge level={p.confidence} /></td>; })}<td className="cap-sub" style={{ maxWidth: 260 }}>{f.method}</td></tr>)}</tbody></table></div>
            </Card>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

export function ScenariosPage() {
  const { intel } = useFilters();
  const [custom, setCustom] = useState<ScenarioInputs | null>(null);
  const [draft, setDraft] = useState<ScenarioInputs>({ volumeMultiplier: 1.5, marginBps: 0, settlementDelayHours: 0, failureRatePct: 2 });
  const r = useResource(() => capitalApi.scenarios(intel, custom ?? undefined), [JSON.stringify(intel), JSON.stringify(custom)]);
  const d = r.data;
  const rowsOf = (k: keyof NonNullable<typeof d>["scenarios"][number]["d90"]) => (d?.scenarios ?? []).map((s) => ({ label: s.name, value: (s.d90[k] ?? 0) as number }));
  return (
    <div>
      <PageHeader title="Scenario Center" sub="Conservative, Base and Aggressive over 90 days — volume, revenue, liquidity, capital requirement, runway and funding gap — plus a custom what-if." freshness={d?.freshness} />
      <Card title="What if…" sub="Set the multipliers and run a custom scenario alongside the presets.">
        <Grid cols={5}>
          <Field label="Volume multiplier"><input className="cap-input" type="number" step={0.1} min={0} value={draft.volumeMultiplier} onChange={(e) => setDraft({ ...draft, volumeMultiplier: Number(e.target.value) })} /></Field>
          <Field label="Margin change (bps)"><input className="cap-input" type="number" step={1} value={draft.marginBps} onChange={(e) => setDraft({ ...draft, marginBps: Number(e.target.value) })} /></Field>
          <Field label="Settlement delay (h)"><input className="cap-input" type="number" step={1} min={0} value={draft.settlementDelayHours} onChange={(e) => setDraft({ ...draft, settlementDelayHours: Number(e.target.value) })} /></Field>
          <Field label="Failure rate (%)"><input className="cap-input" type="number" step={0.5} min={0} value={draft.failureRatePct} onChange={(e) => setDraft({ ...draft, failureRatePct: Number(e.target.value) })} /></Field>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}><button type="button" className="cap-btn primary" onClick={() => setCustom({ ...draft })}>Run</button>{custom && <button type="button" className="cap-btn" onClick={() => setCustom(null)}>Clear</button>}</div>
        </Grid>
      </Card>
      <div style={{ height: 14 }} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Card title="Comparison (90 days)" pad={false}>
              <div className="cap-tablewrap"><table className="cap-table" data-cols={7}><thead><tr><th>Scenario</th><th className="r">Volume</th><th className="r">Net revenue</th><th className="r">Liquidity req.</th><th className="r">Capital req.</th><th className="r">Runway</th><th className="r">Funding gap</th></tr></thead><tbody>{d.scenarios.map((s) => <tr key={s.name}><td><b>{s.name}</b><div className="cap-sub">×{s.inputs.volumeMultiplier} · {s.inputs.marginBps >= 0 ? "+" : ""}{s.inputs.marginBps} bps · {s.inputs.settlementDelayHours} h · {pct(s.inputs.failureRatePct)} fail</div></td><td className="r num">{money(s.d90.volume, "XAF", { compact: true })}</td><td className="r num">{money(s.d90.revenue, "XAF", { compact: true })}</td><td className="r num">{money(s.d90.liquidityRequirement, "XAF", { compact: true })}</td><td className="r num">{money(s.d90.capitalRequirement, "XAF", { compact: true })}</td><td className="r num">{s.d90.runwayDays == null ? "—" : `${s.d90.runwayDays} d`}</td><td className="r num" style={{ color: s.d90.fundingGap > 0 ? "var(--bad)" : "var(--recv)" }}>{money(s.d90.fundingGap, "XAF", { compact: true })}</td></tr>)}</tbody></table></div>
            </Card>
            <Grid cols={2}>
              <Card title="Liquidity requirement by scenario"><ChartContainer title="Liquidity requirement" unit="XAF" height={140}><BarChart rows={rowsOf("liquidityRequirement")} /></ChartContainer></Card>
              <Card title="Funding gap by scenario"><ChartContainer title="Funding gap" unit="XAF" height={140}><BarChart rows={rowsOf("fundingGap")} color="var(--bad)" /></ChartContainer></Card>
            </Grid>
            <Grid cols={d.scenarios.length}>{d.scenarios.map((s) => <Card key={s.name} title={s.name}><CalculationTrace calc={s.calculation} /></Card>)}</Grid>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

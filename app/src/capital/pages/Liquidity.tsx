/* ============================================================
   /capital-intelligence/liquidity — position, breakdowns, charts, and the
   interactive stress-test module (NORMAL / ELEVATED / STRESS / SEVERE + custom).
   A stress test never executes anything; it is a calculation on screen.
   ============================================================ */
import { useEffect, useState } from "react";
import type { StressInputs, StressPreset, StressResult } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { money, pct, ratio } from "../lib/money.js";
import { PageHeader, Grid, MetricCard, Card, DataState, KV, RiskBadge, LiquidityMeter, SourceTrace, CalculationTrace, Seg, Field, ErrorLine, DataTable, PartialBanner, type Column } from "../components/ui.js";
import { ChartContainer, LineChart, ColumnChart, BarChart } from "../components/charts.js";

const PRESETS: StressPreset[] = ["NORMAL", "ELEVATED", "STRESS", "SEVERE"];
const INPUT_LABEL: Record<keyof StressInputs, [string, string]> = { volumeIncreasePct: ["Transaction volume increase", "%"], settlementDelayHours: ["Settlement delay", "hours"], failureRatePct: ["Failure rate", "%"], withdrawalPct: ["Liquidity withdrawal", "%"], peakDemandMultiplier: ["Peak demand", "× average"], reserveRequirementPct: ["Reserve requirement", "%"] };

export function LiquidityPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.liquidity(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const brk: Column<{ key: string; label: string; available: number; required: number; utilizationPct: number | null }>[] = [
    { key: "label", label: "Segment", render: (x) => x.label, sort: (x) => x.label },
    { key: "available", label: "Available", right: true, render: (x) => money(x.available, "XAF"), sort: (x) => x.available },
    { key: "required", label: "Required (30d)", right: true, render: (x) => money(x.required, "XAF"), sort: (x) => x.required },
    { key: "util", label: "Utilisation", right: true, render: (x) => pct(x.utilizationPct), sort: (x) => x.utilizationPct ?? -1 },
  ];
  return (
    <div>
      <PageHeader title="Liquidity" sub="The payout float the settlement engine gates on, what the next 30 days will draw on it, and how it holds under stress." freshness={d?.freshness} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            {/NO rail balance|ceiling|not configured/i.test(d.basis) && <PartialBanner text={`The float figure is not a measured rail balance: ${d.basis}`} />}
            {d.stranded.count > 0 && <div className="cap-banner" data-tone="warn">⚠ {d.stranded.count} stranded earmark(s) hold {money(d.stranded.xaf, "XAF")} of float that will never pay out — release them in Admin → Liquidity.</div>}
            <Grid cols={4}>
              <MetricCard label="Available liquidity" value={money(d.available, "XAF", { compact: true })} hint={money(d.available, "XAF")} sub={d.basis} tone={d.gap > 0 ? "bad" : "good"} />
              <MetricCard label="Required (30 days)" value={money(d.required, "XAF", { compact: true })} hint="Demand + settlement buffer + peak buffer + reserve" sub={<span>gap <b className="num">{money(d.gap, "XAF", { compact: true })}</b></span>} />
              <MetricCard label="Utilisation" value={pct(d.utilizationPct)} sub={<span>turnover {ratio(d.turnover)} per 30 days</span>} />
              <MetricCard label="Reserve" value={money(d.requiredReserve, "XAF", { compact: true })} sub={<span>idle {money(d.idle, "XAF", { compact: true })} · reserved {money(d.reserved, "XAF", { compact: true })}</span>} />
            </Grid>
            <div className="cap-split">
              <Card title="Float over time" sub="Daily inflow (crypto received, XAF value) against outflow (Mobile Money paid), and the float that results.">
                <ChartContainer title="Inflows vs outflows" question="Is the float being replenished as fast as it is drawn?" legend={[{ label: "Inflow", color: "var(--recv)" }, { label: "Outflow", color: "var(--accent)" }]} unit="XAF" empty={!d.series.some((s) => s.inflow || s.outflow)}><ColumnChart labels={d.series.map((s) => s.date)} series={[{ name: "Inflow", values: d.series.map((s) => s.inflow), color: "var(--recv)" }, { name: "Outflow", values: d.series.map((s) => s.outflow), color: "var(--accent)" }]} /></ChartContainer>
              </Card>
              <Card title="Coverage"><LiquidityMeter available={d.available} required={d.required} /><div style={{ marginTop: 10 }}><KV k="Floor (20% of capacity)" v={money(d.floorXaf, "XAF")} /><KV k="Capacity" v={money(d.total, "XAF")} /></div></Card>
            </div>
            <Card title="Liquidity requirement forecast" sub="Cumulative projected demand over 90 days with an 80% band — the requirement the float must keep up with.">
              <ChartContainer title="Projected demand" question="How much will be drawn, and how uncertain is that?" legend={[{ label: "Expected", color: "var(--ink)" }, { label: "80% band", color: "var(--info)" }]} unit="XAF" empty={!d.requirementForecast.length}><LineChart labels={d.requirementForecast.map((p) => p.date)} series={[{ name: "Expected", values: d.requirementForecast.map((p) => p.expected), color: "var(--ink)" }]} band={{ lower: d.requirementForecast.map((p) => p.lower), upper: d.requirementForecast.map((p) => p.upper) }} /></ChartContainer>
            </Card>
            <Grid cols={2}>
              <Card title="By rail" pad={false}><DataTable rows={d.byRail} columns={brk} rowKey={(x) => x.key} stack empty="No completed payments in the period." /></Card>
              <Card title="By provider" pad={false}><DataTable rows={d.byProvider} columns={brk} rowKey={(x) => x.key} stack empty="No completed payments in the period." /></Card>
              <Card title="By country" pad={false}><DataTable rows={d.byCountry} columns={brk} rowKey={(x) => x.key} stack empty="No completed payments in the period." /></Card>
              <Card title="By currency" pad={false}><DataTable rows={d.byCurrency} columns={brk} rowKey={(x) => x.key} stack /></Card>
            </Grid>
            <StressModule presets={d.stress} />
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

function StressModule({ presets }: { presets: Record<StressPreset, StressResult> }) {
  const { intel } = useFilters();
  const [preset, setPreset] = useState<StressPreset | "CUSTOM">("NORMAL");
  const [inputs, setInputs] = useState<StressInputs>(presets.NORMAL.inputs);
  const [result, setResult] = useState<StressResult>(presets.NORMAL);
  useEffect(() => { if (preset !== "CUSTOM") { setInputs(presets[preset].inputs); setResult(presets[preset]); } }, [preset, presets]);
  const run = useAction(() => capitalApi.stress(intel, "CUSTOM", inputs), (r) => setResult(r));
  return (
    <Card title="Liquidity stress testing" sub="Adjust the assumptions and see the requirement, projected liquidity and coverage. Nothing here executes — it is a calculation for management to weigh." action={<Seg options={[...PRESETS, "CUSTOM"] as Array<StressPreset | "CUSTOM">} value={preset} onChange={setPreset} />}>
      <div className="cap-split">
        <div>
          <Grid cols={3}>
            {(Object.keys(INPUT_LABEL) as Array<keyof StressInputs>).map((k) => <Field key={k} label={`${INPUT_LABEL[k][0]} (${INPUT_LABEL[k][1]})`}><input className="cap-input" type="number" step={k === "peakDemandMultiplier" ? 0.1 : 1} min={0} value={inputs[k]} onChange={(e) => { setPreset("CUSTOM"); setInputs((i) => ({ ...i, [k]: Number(e.target.value) })); }} aria-label={INPUT_LABEL[k][0]} /></Field>)}
          </Grid>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}><button type="button" className="cap-btn primary" disabled={run.busy} onClick={() => run.run()}>{run.busy ? "Calculating…" : "Run stress test"}</button><span className="cap-sub">Scenario: {result.preset}</span></div>
          <ErrorLine error={run.error} />
          <div style={{ marginTop: 12 }}><CalculationTrace calc={result.calculation} /></div>
        </div>
        <div className="cap-card" style={{ padding: 14, boxShadow: "none" }}>
          <KV k="Current liquidity" v={money(result.currentLiquidity, "XAF")} /><KV k="Required liquidity" v={money(result.requiredLiquidity, "XAF")} /><KV k="Projected liquidity" v={money(result.projectedLiquidity, "XAF")} />
          <KV k="Liquidity gap" v={<span style={{ color: result.gap > 0 ? "var(--bad)" : "var(--recv)" }}>{money(result.gap, "XAF")}</span>} /><KV k="Coverage ratio" v={ratio(result.coverageRatio)} /><KV k="Risk level" v={<RiskBadge level={result.riskLevel} />} />
          <div style={{ marginTop: 12 }}><ChartContainer title="Coverage by preset" question="Where does coverage fall below 1.0×?" height={120}><BarChart rows={PRESETS.map((p) => ({ label: p, value: presets[p].coverageRatio ?? 0, color: (presets[p].coverageRatio ?? 0) >= 1 ? "var(--recv)" : "var(--bad)" }))} unit="×" max={Math.max(1.5, ...PRESETS.map((p) => presets[p].coverageRatio ?? 0))} /></ChartContainer></div>
        </div>
      </div>
    </Card>
  );
}

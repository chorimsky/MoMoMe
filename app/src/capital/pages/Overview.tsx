/* ============================================================
   /capital-intelligence — Executive Overview, and /health — Capital Health.
   ============================================================ */
import { Link } from "react-router-dom";
import { CAPITAL_TYPES, CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { useResource } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { money, pct, count, ratio } from "../lib/money.js";
import { PageHeader, Grid, MetricCard, FinancialMetric, Card, DataState, KV, RiskBadge, ConfidenceBadge, LiquidityMeter, CapitalGapIndicator, SourceTrace, CapitalTypeBadge, Badge } from "../components/ui.js";
import { ChartContainer, LineChart, BarChart } from "../components/charts.js";

export function ExecutiveOverview() {
  const { intel, filters } = useFilters();
  const r = useResource(() => capitalApi.overview(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const ccy = filters.ccy === "USD" ? "USD" : "XAF";
  return (
    <div>
      <PageHeader title="Capital Intelligence" sub="Understand how MoMo›Me's transaction activity, liquidity, revenue and capital position interact." freshness={d?.freshness} action={<Link to="/ai-copilot" className="cap-btn">Ask the copilot</Link>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            {ccy === "USD" && <div className="cap-banner" data-tone="info">Operating figures are booked in XAF. Capital ledgers are in USD. Amounts are shown in their booked currency; no conversion is applied to the display.</div>}
            <Grid cols={4}>
              <MetricCard label="Transaction volume" value={money(d.volume.current, "XAF", { compact: true })} hint={money(d.volume.current, "XAF")} trend={d.volume.growthPct} sub={<span>{count(d.volume.count)} payments · prev {money(d.volume.previous, "XAF", { compact: true })}</span>} spark={d.volume.trend} to="/capital-intelligence/transactions" />
              <MetricCard label="Revenue" value={money(d.revenue.gross, "XAF", { compact: true })} hint={money(d.revenue.gross, "XAF")} sub={<span>net {money(d.revenue.net, "XAF", { compact: true })} · margin {pct(d.revenue.marginPct)}</span>} tone={d.revenue.net < 0 ? "bad" : undefined} to="/capital-intelligence/revenue" />
              <MetricCard label="Liquidity" value={money(d.liquidity.available, "XAF", { compact: true })} hint={money(d.liquidity.available, "XAF")} sub={<span>required {money(d.liquidity.required, "XAF", { compact: true })} · gap {money(d.liquidity.gap, "XAF", { compact: true })}</span>} tone={d.liquidity.gap > 0 ? "bad" : "good"} to="/capital-intelligence/liquidity" />
              <MetricCard label="Capital (USD)" value={money(d.capital.received, "USD", { compact: true })} hint={money(d.capital.received, "USD")} sub={<span>committed {money(d.capital.committed, "USD", { compact: true })} · deployed {money(d.capital.deployed, "USD", { compact: true })} · available {money(d.capital.available, "USD", { compact: true })}</span>} to="/capital" />
            </Grid>
            <div className="cap-split">
              <Card title="Forecast" sub="Expected transaction volume with an 80% band. Confidence falls with the sample size — a band this wide is information, not a flaw.">
                <Grid cols={3}>
                  {([["Next 30 days", d.forecast.d30], ["Next 90 days", d.forecast.d90], ["Next 180 days", d.forecast.d180]] as const).map(([l, f]) => (
                    <div key={l} className="cap-card" style={{ padding: 12, boxShadow: "none" }}>
                      <div className="overline">{l}</div><div className="num" style={{ fontSize: 20, fontWeight: 750, marginTop: 4 }}>{money(f.expected, "XAF", { compact: true })}</div>
                      <div className="cap-sub num">{money(f.lower, "XAF", { compact: true })} – {money(f.upper, "XAF", { compact: true })}</div><div style={{ marginTop: 6 }}><ConfidenceBadge level={f.confidence} /></div>
                    </div>
                  ))}
                </Grid>
                <div style={{ marginTop: 10 }}><Link to="/capital-intelligence/forecasts" className="cap-btn sm">Open forecasts</Link></div>
              </Card>
              <Card title="Capital requirement" sub="From the open requirements the engine derived and management entered.">
                <CapitalGapIndicator requirement={d.requirement.current} available={d.requirement.availableCapital} ccy="XAF" urgency={d.requirement.urgency} />
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}><Link to="/capital-intelligence/capital-requirements" className="cap-btn sm">Requirements</Link><Link to="/capital-intelligence/investor-matching" className="cap-btn sm">Match investors</Link></div>
              </Card>
            </div>
            <div className="cap-split">
              <Card title="Liquidity coverage" sub={d.liquidity.basis}><LiquidityMeter available={d.liquidity.available} required={d.liquidity.required} /><div style={{ marginTop: 8 }}><KV k="Coverage ratio" v={ratio(d.liquidity.coverageRatio)} /><KV k="Urgency" v={<RiskBadge level={d.requirement.urgency} />} /></div></Card>
              <Card title="Sources" sub="Every figure above is computed from these records."><SourceTrace sources={d.sources} /></Card>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}

const FLOW_LABEL: Record<string, string> = { CAPITAL: "Capital", ALLOCATED: "Allocated", DEPLOYED: "Deployed", OPERATING_ACTIVITY: "Operating activity", REVENUE: "Revenue", RETURN: "Return / reinvestment" };
export function CapitalHealth() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.health(intel), [JSON.stringify(intel)]);
  const d = r.data;
  return (
    <div>
      <PageHeader title="Capital Health" sub="Corporate, liquidity, growth and strategic capital — what is committed, received, deployed, available and idle. Every number links to its ledger." freshness={d?.freshness} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid cols={5}>
              <FinancialMetric label="Total capital" amount={d.total.received} ccy="USD" sub={`committed ${money(d.total.committed, "USD", { compact: true })}`} to="/capital" />
              <FinancialMetric label="Deployed" amount={d.total.deployed} ccy="USD" to="/capital/allocations" />
              <FinancialMetric label="Available" amount={d.total.available} ccy="USD" to="/capital" />
              <FinancialMetric label="Reserved" amount={d.total.reserved} ccy="USD" />
              <FinancialMetric label="Idle" amount={d.total.idle} ccy="USD" tone={d.total.idle > 0 && d.total.received > 0 && d.total.idle / d.total.received > 0.5 ? "warn" : undefined} to="/capital-intelligence/efficiency" />
            </Grid>
            <Grid cols={4}>
              {CAPITAL_TYPES.map((t) => { const b = d.byType[t]; return (
                <Card key={t} title={<span>{CAPITAL_TYPE_LABEL[t]} <span className="cap-sub">/ {t}</span></span>} action={<Link to={`/capital/${({ OWN: "equity", POWER: "liquidity", SCALE: "growth", STRATEGIC: "strategic" } as const)[t]}`} className="cap-btn sm">Ledger</Link>}>
                  <KV k="Committed" v={money(b.committed, "USD")} /><KV k="Received" v={money(b.received, "USD")} /><KV k="Deployed" v={money(b.deployed, "USD")} /><KV k="Available" v={money(b.available, "USD")} /><KV k="Idle" v={money(b.idle, "USD")} />
                </Card>
              ); })}
            </Grid>
            <div className="cap-split">
              <Card title="Capital flow" sub="Capital → allocated → deployed → operating activity → revenue → return. Each stage is traceable to its record.">
                <div className="cap-flow">{d.flow.map((f, i) => <div key={f.stage} className="cap-flow-step"><span className="cap-sub num">{i + 1}</span><div><div style={{ fontWeight: 650 }}>{FLOW_LABEL[f.stage]}</div><div className="cap-sub"><Link to={f.source.kind === "transactions" ? "/capital-intelligence/transactions" : f.source.kind === "pricing" ? "/capital-intelligence/revenue" : "/capital"}>{f.source.label}</Link></div></div><span className="num" style={{ fontWeight: 700 }}>{money(f.amount, f.ccy, { compact: true })}</span></div>)}</div>
              </Card>
              <div style={{ display: "grid", gap: 12 }}>
                <Card title="Capital by type"><ChartContainer title="Received capital" unit="USD" height={160}><BarChart rows={CAPITAL_TYPES.map((t) => ({ label: CAPITAL_TYPE_LABEL[t], value: d.byType[t].received }))} unit=" USD" /></ChartContainer></Card>
                <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
              </div>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
export { CapitalTypeBadge, Badge, LineChart };

/* ============================================================
   /capital-intelligence/transactions — transaction intelligence with the
   Total volume → Route → Transaction drill-down.
   /capital-intelligence/routes — per-route economics and comparison.
   /capital-intelligence/revenue — revenue with breakdowns.
   ============================================================ */
import { useMemo, useState } from "react";
import type { IntelTransactions, RouteIntel, RevenueSlice, MarginDiagnosis } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { useResource } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { money, pct, count, seconds, ratio, dateTime } from "../lib/money.js";
import { PageHeader, Grid, MetricCard, Card, DataState, DataTable, StatusBadge, SourceTrace, Seg, exportCsv, KV, type Column } from "../components/ui.js";
import { ChartContainer, LineChart, BarChart, ColumnChart } from "../components/charts.js";

type Row = IntelTransactions["rows"][number];
export function TransactionsPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.transactions(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const [route, setRoute] = useState<string | null>(null);
  const [status, setStatus] = useState<"All" | "Completed" | "Pending" | "Failed">("All");
  const rows = useMemo(() => (d?.rows ?? []).filter((x) => (!route || x.routeId === route) && (status === "All" || x.status === status)), [d, route, status]);
  const cols: Column<Row>[] = [
    { key: "ref", label: "Reference", render: (x) => <span className="mono" style={{ fontSize: 12 }}>{x.ref}</span>, sort: (x) => x.ref },
    { key: "at", label: "Created", render: (x) => dateTime(x.at), sort: (x) => x.at },
    { key: "route", label: "Route", render: (x) => `${x.method} → ${x.provider}` },
    { key: "country", label: "Country", render: (x) => x.country },
    { key: "xaf", label: "Amount", right: true, render: (x) => money(x.xaf, "XAF"), sort: (x) => x.xaf },
    { key: "fee", label: "Fee", right: true, render: (x) => money(x.feeXaf, "XAF"), sort: (x) => x.feeXaf },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
  ];
  return (
    <div>
      <PageHeader title="Transaction Intelligence" sub="Count, volume, success and settlement of the payments the engine processed — and what they earned and cost." freshness={d?.freshness} action={d && <button type="button" className="cap-btn" onClick={() => exportCsv(`transactions-${intel.period}.csv`, ["ref", "created", "method", "provider", "country", "xaf", "feeXaf", "status", "state"], rows.map((x) => [x.ref, x.at, x.method, x.provider, x.country, x.xaf, x.feeXaf, x.status, x.state]))}>Export CSV</button>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid cols={5}>
              <MetricCard label="Transactions" value={count(d.totals.count)} sub={`avg ${money(d.totals.avgSize, "XAF", { compact: true })}`} />
              <MetricCard label="Volume" value={money(d.totals.volume, "XAF", { compact: true })} hint={money(d.totals.volume, "XAF")} />
              <MetricCard label="Success rate" value={pct(d.totals.successRatePct)} sub={`failure ${pct(d.totals.failureRatePct)}`} tone={(d.totals.failureRatePct ?? 0) > 8 ? "bad" : undefined} />
              <MetricCard label="Settlement (p50)" value={seconds(d.totals.settlementSecP50)} />
              <MetricCard label="Margin" value={money(d.totals.margin, "XAF", { compact: true })} sub={<span>revenue {money(d.totals.revenue, "XAF", { compact: true })} · cost {money(d.totals.cost, "XAF", { compact: true })} · {pct(d.totals.marginPct)}</span>} tone={d.totals.margin < 0 ? "bad" : undefined} />
            </Grid>
            <Card title="Activity" sub="Daily completed volume and failures.">
              <ChartContainer title="Daily volume" question="Is activity growing, and are failures keeping pace?" legend={[{ label: "Volume", color: "var(--ink)" }]} unit="XAF" empty={!d.daily.some((x) => x.volume)}><LineChart labels={d.daily.map((x) => x.date)} series={[{ name: "Volume", values: d.daily.map((x) => x.volume), color: "var(--ink)" }]} /></ChartContainer>
            </Card>
            <Card title="By route" sub="Total volume → route. Select a route to drill into its transactions." pad={false}>
              <DataTable rows={d.byRoute} columns={[
                { key: "label", label: "Route", render: (x) => x.label, sort: (x) => x.label },
                { key: "count", label: "Count", right: true, render: (x) => count(x.count), sort: (x) => x.count },
                { key: "volume", label: "Volume", right: true, render: (x) => money(x.volume, "XAF"), sort: (x) => x.volume },
                { key: "sr", label: "Success", right: true, render: (x) => pct(x.successRatePct), sort: (x) => x.successRatePct ?? -1 },
                { key: "settle", label: "Settlement p50", right: true, render: (x) => seconds(x.settlementSecP50), sort: (x) => x.settlementSecP50 ?? -1 },
                { key: "margin", label: "Margin", right: true, render: (x) => <span style={{ color: x.margin < 0 ? "var(--bad)" : undefined }}>{money(x.margin, "XAF")} <span className="cap-sub">({pct(x.marginPct)})</span></span>, sort: (x) => x.margin },
              ]} rowKey={(x) => x.routeId} onRow={(x) => setRoute(route === x.routeId ? null : x.routeId)} selectedKey={route} empty="No payments in the period." />
            </Card>
            <Card title={route ? `Transactions · ${d.byRoute.find((x) => x.routeId === route)?.label ?? route}` : "Transactions"} sub="Real payment references from the settlement engine (latest 400)." action={<div className="cap-toolbar"><Seg options={["All", "Completed", "Pending", "Failed"] as const} value={status} onChange={setStatus} />{route && <button type="button" className="cap-btn sm" onClick={() => setRoute(null)}>All routes</button>}</div>} pad={false}>
              <DataTable rows={rows} columns={cols} rowKey={(x) => x.id} initialSort={{ key: "at", dir: "desc" }} empty="No transactions match." />
            </Card>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

export function RoutesPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.routes(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const [compare, setCompare] = useState<string[]>([]);
  const toggle = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-3)));
  const cols: Column<RouteIntel>[] = [
    { key: "cmp", label: "Compare", width: 70, render: (x) => <input type="checkbox" aria-label={`Compare ${x.name}`} checked={compare.includes(x.routeId)} onChange={() => toggle(x.routeId)} onClick={(e) => e.stopPropagation()} /> },
    { key: "name", label: "Route", render: (x) => <div><div style={{ fontWeight: 650 }}>{x.name}</div><div className="cap-sub">{x.intermediaries.join(" → ")}</div></div>, sort: (x) => x.name },
    { key: "volume", label: "Volume", right: true, render: (x) => money(x.volume, "XAF"), sort: (x) => x.volume },
    { key: "count", label: "Count", right: true, render: (x) => count(x.count), sort: (x) => x.count },
    { key: "sr", label: "Success", right: true, render: (x) => pct(x.successRatePct), sort: (x) => x.successRatePct ?? -1 },
    { key: "settle", label: "Settle p50", right: true, render: (x) => seconds(x.settlementSecP50), sort: (x) => x.settlementSecP50 ?? -1 },
    { key: "margin", label: "Margin", right: true, render: (x) => <span style={{ color: x.margin < 0 ? "var(--bad)" : undefined }}>{money(x.margin, "XAF")} ({pct(x.marginPct)})</span>, sort: (x) => x.margin },
    { key: "liq", label: "Liquidity req.", right: true, render: (x) => money(x.liquidityRequirement, "XAF"), sort: (x) => x.liquidityRequirement },
    { key: "eff", label: "Efficiency", right: true, render: (x) => ratio(x.capitalEfficiency), sort: (x) => x.capitalEfficiency ?? -1 },
  ];
  const cmp = (d?.routes ?? []).filter((x) => compare.includes(x.routeId));
  return (
    <div>
      <PageHeader title="Payment Route Intelligence" sub="Every source → intermediary → destination path: volume, success, settlement, cost, revenue, margin, and the liquidity each one ties up." freshness={d?.freshness} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={d?.routes.length === 0} emptyHint="Routes appear once payments complete in the selected period.">
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Card title="Routes" sub="Tick up to three routes to compare them." pad={false}><DataTable rows={d.routes} columns={cols} rowKey={(x) => x.routeId} stack={false} initialSort={{ key: "volume", dir: "desc" }} /></Card>
            {cmp.length > 0 && (
              <Card title="Route comparison" action={<button type="button" className="cap-btn sm" onClick={() => setCompare([])}>Clear</button>}>
                <Grid cols={cmp.length}>{cmp.map((x) => <div key={x.routeId} className="cap-card" style={{ padding: 12, boxShadow: "none" }}><div style={{ fontWeight: 700, marginBottom: 6 }}>{x.name}</div><div className="cap-sub" style={{ marginBottom: 8 }}>{[x.source, ...x.intermediaries, x.destination].join(" ↓ ")}</div><KV k="Volume" v={money(x.volume, "XAF")} /><KV k="Success" v={pct(x.successRatePct)} /><KV k="Settlement p50" v={seconds(x.settlementSecP50)} /><KV k="Cost" v={money(x.cost, "XAF")} /><KV k="Revenue" v={money(x.revenue, "XAF")} /><KV k="Margin" v={`${money(x.margin, "XAF")} (${pct(x.marginPct)})`} /><KV k="Liquidity requirement" v={money(x.liquidityRequirement, "XAF")} /><KV k="Capital efficiency" v={ratio(x.capitalEfficiency)} /></div>)}</Grid>
                <div style={{ marginTop: 12 }}><ChartContainer title="Margin by route" question="Which route earns the most per XAF of volume?" unit="%" height={120}><BarChart rows={cmp.map((x) => ({ label: x.name, value: x.marginPct ?? 0 }))} unit="%" /></ChartContainer></div>
              </Card>
            )}
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

export function RevenuePage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.revenue(intel), [JSON.stringify(intel)]);
  const d = r.data;
  const [dim, setDim] = useState<"byRoute" | "byCountry" | "byProvider" | "byProduct">("byRoute");
  const cols: Column<RevenueSlice>[] = [
    { key: "label", label: "Segment", render: (x) => x.label, sort: (x) => x.label },
    { key: "volume", label: "Volume", right: true, render: (x) => money(x.volume, "XAF"), sort: (x) => x.volume },
    { key: "fees", label: "Customer fees", right: true, render: (x) => money(x.customerFees, "XAF"), sort: (x) => x.customerFees },
    { key: "prov", label: "Provider costs", right: true, render: (x) => money(x.providerCosts, "XAF"), sort: (x) => x.providerCosts },
    { key: "settle", label: "Settlement costs", right: true, render: (x) => money(x.settlementCosts, "XAF"), sort: (x) => x.settlementCosts },
    { key: "gross", label: "Gross", right: true, render: (x) => money(x.gross, "XAF"), sort: (x) => x.gross },
    { key: "net", label: "Net", right: true, render: (x) => <span style={{ color: x.net < 0 ? "var(--bad)" : undefined }}>{money(x.net, "XAF")}</span>, sort: (x) => x.net },
    { key: "margin", label: "Margin", right: true, render: (x) => pct(x.marginPct), sort: (x) => x.marginPct ?? -1 },
  ];
  return (
    <div>
      <PageHeader title="Revenue Intelligence" sub="Customer fees and FX spread against provider and settlement costs. Costs are what each payment actually cost where the aggregator reported it, else the contracted schedule, else the assumption — the diagnosis says which, and why the margin is what it is. Set your contracted rates in Settings → Pricing for an exact figure." freshness={d?.freshness} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid cols={5}>
              <MetricCard label="Volume" value={money(d.totals.volume, "XAF", { compact: true })} hint={money(d.totals.volume, "XAF")} />
              <MetricCard label="Customer fees" value={money(d.totals.customerFees, "XAF", { compact: true })} />
              <MetricCard label="Costs" value={money(d.totals.providerCosts + d.totals.settlementCosts, "XAF", { compact: true })} sub={<span>provider {money(d.totals.providerCosts, "XAF", { compact: true })} · settlement {money(d.totals.settlementCosts, "XAF", { compact: true })}</span>} />
              <MetricCard label="Gross revenue" value={money(d.totals.gross, "XAF", { compact: true })} />
              <MetricCard label="Net revenue" value={money(d.totals.net, "XAF", { compact: true })} sub={`margin ${pct(d.totals.marginPct)}`} tone={d.totals.net < 0 ? "bad" : "good"} />
            </Grid>
            <MarginDiagnosisCard dg={d.diagnosis} />
            <Card title="Gross vs net" sub="Daily revenue in the period.">
              <ChartContainer title="Revenue" question="Is net tracking gross, or are costs eating the take?" legend={[{ label: "Gross", color: "var(--ink)" }, { label: "Net", color: "var(--recv)" }]} unit="XAF" empty={!d.daily.some((x) => x.gross)}><ColumnChart labels={d.daily.map((x) => x.date)} series={[{ name: "Gross", values: d.daily.map((x) => x.gross), color: "var(--ink)" }, { name: "Net", values: d.daily.map((x) => x.net), color: "var(--recv)" }]} /></ChartContainer>
            </Card>
            <Card title="Breakdown" action={<Seg options={["byRoute", "byCountry", "byProvider", "byProduct"] as const} value={dim} onChange={setDim} labels={{ byRoute: "Route", byCountry: "Country", byProvider: "Provider", byProduct: "Product" }} />} pad={false}><DataTable rows={d[dim]} columns={cols} rowKey={(x) => x.key} stack={false} initialSort={{ key: "gross", dir: "desc" }} empty="No completed payments in the period." /></Card>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

/* ---------- why the margin is what it is ---------- */
function MarginDiagnosisCard({ dg }: { dg: MarginDiagnosis }) {
  const src = dg.cost.payoutBySource;
  const tone = (sev: MarginDiagnosis["findings"][number]["severity"]) => sev === "critical" ? "var(--bad)" : sev === "warning" ? "var(--warn)" : "var(--ink-3)";
  const part = (label: string, v: number, total: number, color: string) => <div style={{ flex: Math.max(0.5, v), background: color, minWidth: v > 0 ? 6 : 0, height: 10, borderRadius: 3 }} title={`${label} ${money(v, "XAF")} (${total ? Math.round((v / total) * 100) : 0} %)`} />;
  return (
    <Card title={dg.net < 0 ? `Why this period loses ${money(-dg.net, "XAF")}` : `Where the ${money(dg.net, "XAF")} margin comes from`} sub="Every component of the margin, and what to do about each finding — in order of impact.">
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <div className="cap-sub">Revenue {money(dg.revenue.total, "XAF")}</div>
            <div style={{ display: "flex", gap: 3, marginTop: 6 }}>{part("Fees", dg.revenue.fee, dg.revenue.total, "var(--brand)")}{part("Spread", dg.revenue.spread, dg.revenue.total, "var(--accent)")}</div>
            <div className="cap-sub" style={{ marginTop: 4 }}>fees {money(dg.revenue.fee, "XAF")} · spread {money(dg.revenue.spread, "XAF")}</div>
          </div>
          <div>
            <div className="cap-sub">Cost {money(dg.cost.total, "XAF")}</div>
            <div style={{ display: "flex", gap: 3, marginTop: 6 }}>{part("Payout", dg.cost.payout, dg.cost.total, "var(--ink-2)")}{part("Crypto rail", dg.cost.rail, dg.cost.total, "var(--ink-3)")}{part("Fixed", dg.cost.fixed, dg.cost.total, "var(--line)")}</div>
            <div className="cap-sub" style={{ marginTop: 4 }}>payout {money(dg.cost.payout, "XAF")} · rail {money(dg.cost.rail, "XAF")} · fixed {money(dg.cost.fixed, "XAF")}</div>
          </div>
          <div>
            <div className="cap-sub">How the payout cost is known</div>
            <div style={{ display: "flex", gap: 3, marginTop: 6 }}>{part("Invoice", src.invoice.xaf, dg.cost.payout, "var(--good, #1F7A52)")}{part("Contract", src.contract.xaf, dg.cost.payout, "var(--brand)")}{part("Published", src.published.xaf, dg.cost.payout, "var(--accent)")}{part("Assumed", src.assumed.xaf, dg.cost.payout, "var(--bad)")}</div>
            <div className="cap-sub" style={{ marginTop: 4 }}>invoice {src.invoice.count} · contract {src.contract.count} · published {src.published.count} · <span style={{ color: src.assumed.count ? "var(--bad)" : undefined }}>assumed {src.assumed.count}</span></div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {dg.findings.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "6px 1fr", gap: 12, alignItems: "stretch" }}>
              <div style={{ background: tone(f.severity), borderRadius: 3 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.title}{f.impactXaf != null && <span className="cap-sub" style={{ marginLeft: 8 }}>{money(f.impactXaf, "XAF")}</span>}</div>
                <div className="cap-sub" style={{ marginTop: 2, lineHeight: 1.45 }}>{f.detail}</div>
                <div style={{ fontSize: 12.5, marginTop: 4 }}>→ {f.action}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="cap-sub">Average ticket {money(dg.facts.avgTicket, "XAF")} · {dg.facts.feeAtFloor} at the minimum fee · {dg.facts.merchantPaid} merchant-paid · {dg.facts.noSpreadRecorded} without a recorded spread{dg.facts.breakEvenTicket != null && dg.facts.breakEvenTicket > 0 ? ` · break-even ticket ≈ ${money(dg.facts.breakEvenTicket, "XAF")}` : ""}.</div>
      </div>
    </Card>
  );
}

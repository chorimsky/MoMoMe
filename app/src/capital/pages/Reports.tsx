/* ============================================================
   /reports (+ /:id) — generate, preview, export and download reports.
   ============================================================ */
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Period, ReportKind } from "@shared/capital.js";
import { PERIODS, REPORT_KINDS } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { dateTime } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, SourceTrace, ErrorLine, Badge, exportCsv, type Column } from "../components/ui.js";

const PERIOD_LABEL: Record<Period, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "180d": "Last 180 days", "365d": "Last 12 months" };

export function ReportsPage() {
  const { filters } = useFilters();
  const [sp] = useSearchParams();
  const r = useResource(() => capitalApi.reports(), []);
  const [kind, setKind] = useState<ReportKind>((sp.get("kind") as ReportKind) || "EXECUTIVE_CAPITAL");
  const [period, setPeriod] = useState<Period>(filters.period as Period);
  const [preview, setPreview] = useState<string | null>(null);
  const [investorId, setInvestorId] = useState("");
  const investors = useResource(() => capitalApi.investors().catch(() => ({ investors: [] })), [], { enabled: kind === "INVESTOR" });
  const gen = useAction(() => capitalApi.generateReport({ kind, period, investorId: kind === "INVESTOR" && investorId ? investorId : undefined }), (rep) => { setPreview(rep.id); r.refresh(); });
  const kindFilter = sp.get("kind") as ReportKind | null;
  const rows = (r.data?.reports ?? []).filter((x) => !kindFilter || x.kind === kindFilter);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "title", label: "Report", render: (x) => <Link to={`/reports/${x.id}`}><b>{x.title}</b></Link>, sort: (x) => x.title },
    { key: "period", label: "Period", render: (x) => PERIOD_LABEL[x.period] },
    { key: "at", label: "Generated", render: (x) => dateTime(x.generatedAt), sort: (x) => x.generatedAt },
    { key: "by", label: "By", render: (x) => x.generatedBy },
  ];
  return (
    <div>
      <PageHeader title="Reports" sub="Generated from the engine and the records at the moment you ask; each report is kept with its sources so it can be audited later." />
      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Generate a report">
          <Grid cols={4}>
            <label className="cap-field"><span>Report</span><select className="cap-select" value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>{REPORT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.title}</option>)}</select></label>
            <label className="cap-field"><span>Period</span><select className="cap-select" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select></label>
            {kind === "INVESTOR" ? <label className="cap-field"><span>Investor</span><select className="cap-select" value={investorId} onChange={(e) => setInvestorId(e.target.value)}><option value="">All investors</option>{(investors.data?.investors ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label> : <div />}
            <div style={{ display: "flex", alignItems: "flex-end" }}><button type="button" className="cap-btn primary" disabled={gen.busy} onClick={() => gen.run()}>{gen.busy ? "Generating…" : "Generate & preview"}</button></div>
          </Grid>
          <p className="cap-sub" style={{ marginTop: 8 }}>{REPORT_KINDS.find((k) => k.kind === kind)?.description}</p>
          <ErrorLine error={gen.error} />
        </Card>
        {preview && <ReportView id={preview} embedded />}
        <Card title={kindFilter ? `${REPORT_KINDS.find((k) => k.kind === kindFilter)?.title ?? "Reports"} — history` : "Report history"} action={kindFilter && <Link to="/reports" className="cap-btn sm">All kinds</Link>} pad={false}>
          <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={3} empty={rows.length === 0} emptyHint="No reports generated yet.">
            <DataTable rows={rows} columns={cols} rowKey={(x) => x.id} initialSort={{ key: "at", dir: "desc" }} stack={false} />
          </DataState>
        </Card>
      </div>
    </div>
  );
}

export function ReportView({ id: idProp, embedded }: { id?: string; embedded?: boolean }) {
  const params = useParams();
  const id = idProp ?? params.id ?? "";
  const r = useResource(() => capitalApi.report(id), [id]);
  const d = r.data;
  // The CSV is the same rows the preview shows — export client-side so no second request is needed.
  const download = () => { if (d) exportCsv(`${d.kind.toLowerCase()}-${d.period}.csv`, ["section", "label", "value"], d.sections.flatMap((s) => s.rows.map(([k, v]) => [s.title, k, v]))); };
  const body = (
    <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
      {d && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="cap-toolbar"><Badge>{PERIOD_LABEL[d.period]}</Badge><span className="cap-sub">Generated {dateTime(d.generatedAt)} by {d.generatedBy} · {d.id}</span><span style={{ flex: 1 }} /><button type="button" className="cap-btn" onClick={download}>Download CSV</button><button type="button" className="cap-btn" onClick={() => window.print()}>Print / PDF</button></div>
          {d.sections.map((s) => <Card key={s.title} title={s.title} sub={s.note} pad={false}><div className="cap-tablewrap"><table className="cap-table"><tbody>{s.rows.map(([k, v], i) => <tr key={i}><td style={{ width: "40%" }}>{k}</td><td className="num">{v}</td></tr>)}</tbody></table></div></Card>)}
          {d.sections.length === 0 && <div className="cap-state">This report has no rows for the period.</div>}
          <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
        </div>
      )}
    </DataState>
  );
  if (embedded) return <Card title={d?.title ?? "Report"}>{body}</Card>;
  return <div><PageHeader title={d?.title ?? "Report"} action={<Link to="/reports" className="cap-btn">All reports</Link>} />{body}</div>;
}

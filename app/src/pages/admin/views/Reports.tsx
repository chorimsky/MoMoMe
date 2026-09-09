/* ============================================================
   Reports — revenue, volume and provider performance.
   Data: api.adminReports(). CSV export of the byProvider rows.
   ============================================================ */
import { useEffect, useState } from "react";
import type { ReportsSnapshot } from "@shared/types.js";
import { PROVIDERS } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Card, Grid, KV, SectionTitle, SegToggle, Spark } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

function exportCsv(rows: ReportsSnapshot["byProvider"]) {
  const head = ["Provider", "Payments", "Volume XAF", "Success rate %"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((p) => [PROVIDERS[p.id].name, p.payments, p.volumeXaf, p.successRatePct].map(esc).join(","));
  const csv = [head.map(esc).join(","), ...lines].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `momome-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const COLS = "1.6fr 0.9fr 1.1fr 1fr";
const PERIODS = ["Today", "This week", "This month"];
const PERIOD_KEY: Record<string, string> = { "Today": "today", "This week": "week", "This month": "month" };

export function ReportsView() {
  const [data, setData] = useState<ReportsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState("This month");

  useEffect(() => {
    let alive = true;
    api.adminReports(PERIOD_KEY[period])
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr("Couldn't load reports."); });
    return () => { alive = false; };
  }, [period]);

  if (err) return <Failed t="Reports" msg={err} />;
  if (!data) return <Loading t="Reports" s="Revenue, volume and provider performance." />;

  return (
    <div>
      <SectionTitle t="Reports" s="Revenue, volume and provider performance." />
      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <SegToggle options={PERIODS} value={period} onChange={setPeriod} />
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Showing: {period}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" disabled={data.byProvider.length === 0} onClick={() => exportCsv(data.byProvider)} style={{ padding: "9px 14px", fontSize: 13 }}>↓ Export</button>
      </div>

      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Revenue" value={fmt(data.revenueXaf)} unit="XAF" tone="recv" />
        <AKpi label="Volume" value={fmt(data.volumeXaf)} unit="XAF" />
        <AKpi label="Payments" value={fmt(data.payments)} />
        <AKpi label="Customers" value={fmt(data.customers)} />
      </Grid>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card title="Volume trend">
          {data.daily.length > 0
            ? <Spark data={data.daily.map((d) => d.volumeXaf)} h={120} />
            : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No data yet</div>}
        </Card>

        {/* The operator's first question after "how many": why did the rest not complete.
            One row per cause, from the note the state machine wrote when it gave up. */}
        <Card title="Why payments fail" pad={false}>
          <div style={{ padding: "12px 20px 4px", fontSize: 12.5, color: "var(--ink-3)" }}>
            {data.failures.total === 0
              ? "Every payment in this period completed."
              : `${fmt(data.failures.total)} of ${fmt(data.failures.attempts)} payments did not complete (${Math.round(100 * data.failures.total / Math.max(1, data.failures.attempts))}%).`}
          </div>
          {data.failures.reasons.map((r) => (
            <div key={r.state + r.reason} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 12, alignItems: "center", padding: "10px 20px", borderTop: "1px solid var(--line-2)", fontSize: 12.5 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis" }}>{r.reason}</div>
                <div style={{ color: "var(--ink-3)", fontSize: 11.5, marginTop: 2 }}>
                  {r.state}{" · "}{Object.entries(r.methods).map(([m, n]) => `${m} ×${n}`).join(", ")}{r.avgMinutesToFail ? ` · after ~${fmt(r.avgMinutesToFail)} min` : ""}
                </div>
              </div>
              <span className="num" style={{ fontWeight: 700 }}>{fmt(r.count)}</span>
              <span className="num" style={{ color: "var(--ink-2)" }}>{fmt(r.volumeXaf)} XAF</span>
              <span className="num" style={{ color: "var(--ink-3)" }}>{Math.round(100 * r.count / Math.max(1, data.failures.total))}%</span>
            </div>
          ))}
        </Card>

        <Card title="By provider" pad={false}>
          <div className="mm-tablewrap">
            <div className="mm-table">
              <div style={{ display: "grid", gridTemplateColumns: COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
                <span>Provider</span><span>Payments</span><span>Volume</span><span>Success rate</span>
              </div>
              {data.byProvider.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No provider data yet.</div>}
              {data.byProvider.map((p) => (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{PROVIDERS[p.id].name}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.payments)}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.volumeXaf)} XAF</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "var(--recv)" }}>{fmt(p.successRatePct)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

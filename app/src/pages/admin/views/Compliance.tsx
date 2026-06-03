/* ============================================================
   Compliance — KYC posture, flagged transactions, audit trail.
   Data: api.adminCompliance().
   ============================================================ */
import { useEffect, useState } from "react";
import type { ComplianceSnapshot } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Card, Grid, SectionTitle, toneColor } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

const FLAG_COLS = "1fr 0.9fr 0.85fr 1.3fr 0.6fr 0.8fr";

function auditTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ComplianceView() {
  const [data, setData] = useState<ComplianceSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminCompliance()
      .then((c) => { if (alive) setData(c); })
      .catch(() => { if (alive) setErr("Couldn't load compliance data."); });
    return () => { alive = false; };
  }, []);

  if (err) return <Failed t="Compliance" msg={err} />;
  if (!data) return <Loading t="Compliance" s="KYC, risk and the audit trail." />;

  return (
    <div>
      <SectionTitle t="Compliance" s="KYC, risk and the audit trail." />
      <Grid cols={3} style={{ marginBottom: 14 }}>
        <AKpi label="Verified" value={fmt(data.kyc.verified)} tone="recv" />
        <AKpi label="Pending review" value={fmt(data.kyc.pending)} tone="warn" />
        <AKpi label="Rejected" value={fmt(data.kyc.rejected)} tone="bad" />
      </Grid>

      <Card title="Flagged transactions" sub="Transactions held for manual risk review" pad={false} style={{ marginBottom: 16 }}>
        <div className="mm-tablewrap">
          <div className="mm-table">
            <div style={{ display: "grid", gridTemplateColumns: FLAG_COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
              <span>Reference</span><span>Number</span><span>Amount</span><span>Reason</span><span>Risk</span><span>Peex</span>
            </div>
            {data.flagged.length === 0 && (
              <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No flagged transactions.</div>
            )}
            {data.flagged.map((f) => (
              <div key={f.ref} style={{ display: "grid", gridTemplateColumns: FLAG_COLS, gap: 0, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)" }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 600 }}>{f.ref}</span>
                <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{f.phone}</span>
                <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(f.amountXaf)} XAF</span>
                <span style={{ fontSize: 12.5 }}>{f.reason}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: toneColor(f.level), flex: "none" }} />
                  <span style={{ fontSize: 12, fontWeight: 650, color: toneColor(f.level), textTransform: "capitalize" }}>{f.level}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {f.peexSignal ? (
                    <>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: toneColor(f.peexSignal === "review" ? "warn" : "recv"), flex: "none" }} />
                      <span className="num" style={{ fontSize: 12, fontWeight: 650, color: f.peexSignal === "review" ? "var(--warn)" : "var(--recv)" }} title={`Peex: ${f.peexSignal}`}>{f.peexRisk}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Audit log" sub="Most recent compliance events first" pad={false}>
        {data.audit.length === 0 && (
          <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No audit events.</div>
        )}
        {data.audit.map((a, i) => (
          <div key={a.ref + a.at + i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: i < data.audit.length - 1 ? "1px solid var(--line-2)" : "none" }}>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap", flex: "none" }}>{auditTime(a.at)}</span>
            <span className="num" style={{ fontSize: 12, fontWeight: 600, flex: "none" }}>{a.ref}</span>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.event}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

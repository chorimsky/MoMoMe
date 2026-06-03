/* ============================================================
   MoMo›Me — Operations dashboard (ported from project/ops.jsx).
   Live, wired to the real backend via api.opsSnapshot(), polled
   every 2000ms. Top KPI strip · rail health · live tx feed.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { OpsSnapshot, OpsTx, PaymentState } from "@shared/types.js";
import { Logo, Flag, ProviderChip, RailBadge, Spinner } from "../../components/atoms.js";
import { fmt } from "../../lib/format.js";
import { api } from "../../api/client.js";

/* ---------- state → label + colour ---------- */
type StateMeta = { label: string; color: string; pulse: boolean };

const STATE_META: Record<PaymentState, StateMeta> = {
  QUOTED:             { label: "Quoted",          color: "var(--ink-3)", pulse: false },
  AWAITING_INBOUND:   { label: "Awaiting inbound", color: "var(--send)", pulse: true },
  INBOUND_DETECTED:   { label: "Detected",        color: "var(--send)",  pulse: true },
  INBOUND_CONFIRMED:  { label: "Confirmed",       color: "var(--info)",  pulse: true },
  FX_LOCKED:          { label: "FX locked",       color: "var(--info)",  pulse: true },
  PAYOUT_REQUESTED:   { label: "Paying out",      color: "var(--warn)",  pulse: true },
  PAYOUT_CONFIRMED:   { label: "Payout confirmed", color: "var(--warn)", pulse: true },
  DELIVERED:          { label: "Delivered",       color: "var(--recv)",  pulse: false },
  REFUND_PENDING:     { label: "Refund pending",  color: "var(--warn)",  pulse: true },
  REFUNDED:           { label: "Refunded",        color: "var(--bad)",   pulse: false },
  FAILED:             { label: "Failed",          color: "var(--bad)",   pulse: false },
  MANUAL_REVIEW:      { label: "Manual review",   color: "var(--bad)",   pulse: true },
};

function timeAgo(s: number): string {
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h ago";
}

const railLatency = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms");

/* ---------- KPI card ---------- */
function Kpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px", borderRadius: "var(--r)" }}>
      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 700, color: "var(--ink-3)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <span className="num" style={{ fontSize: 27, fontWeight: 750, letterSpacing: "-0.02em" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-3)" }}>{unit}</span>}
      </div>
    </div>
  );
}

/* ---------- rail health ---------- */
function RailHealth({ rails }: { rails: OpsSnapshot["rails"] }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Rail health</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {rails.map((r) => (
          <div key={r.method} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span className="dot" style={{ width: 8, height: 8, background: r.healthy ? "var(--recv)" : "var(--warn)", boxShadow: `0 0 0 3px ${r.healthy ? "var(--recv-wash)" : "var(--send-wash)"}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ marginBottom: 3 }}><RailBadge rail={r.method} /></div>
              <div className="mono" style={{ fontSize: 10.5, color: r.healthy ? "var(--ink-3)" : "var(--warn)" }}>
                {r.healthy ? "Operational" : "Degraded"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="num" style={{ fontSize: 12, fontWeight: 600 }}>{railLatency(r.latencyMs)}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>latency</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- transactions feed ---------- */
function TxRow({ t }: { t: OpsTx }) {
  const sm = STATE_META[t.state];
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1.2fr 1.1fr 0.7fr", gap: 0, alignItems: "center",
        padding: "12px 20px", borderBottom: "1px solid var(--line-2)",
        animation: t.live ? "fadeUp .4s ease both" : "none",
        background: t.live ? "var(--accent-wash)" : "transparent", transition: "background 1s",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 650, fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}>
          <Flag country={t.country} size={14} /> <span className="mono" style={{ fontSize: 12 }}>{t.ref}</span>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{t.id}</div>
      </div>
      <div><RailBadge rail={t.method} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="num" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--recv)" }}>{fmt(t.xaf)} XAF</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          <ProviderChip id={t.provider} />
        </div>
      </div>
      <div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: sm.color, whiteSpace: "nowrap" }}>
          <span className="dot" style={{ background: sm.color, animation: sm.pulse ? "pulse 1.2s infinite" : "none" }} />
          {sm.label}
        </span>
      </div>
      <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>{timeAgo(t.ageSec)}</div>
    </div>
  );
}

function TxTable({ rows }: { rows: OpsTx[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 16 }}>Live transactions</h3>
          <span className="pill" style={{ fontSize: 10.5 }}>
            <span className="dot" style={{ background: "var(--recv)", animation: "pulse 1.4s infinite" }} />streaming
          </span>
        </div>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{rows.length} shown</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1.2fr 1.1fr 0.7fr", gap: 0, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, color: "var(--ink-3)", padding: "0 20px 8px", borderBottom: "1px solid var(--line)" }}>
        <span>Reference</span><span>Inbound rail</span><span>Payout</span><span>State</span><span style={{ textAlign: "right" }}>Age</span>
      </div>
      <div style={{ maxHeight: 560, overflowY: "auto" }}>
        {rows.length === 0
          ? <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>No transactions in flight.</div>
          : rows.map((t) => <TxRow key={t.id} t={t} />)}
      </div>
    </div>
  );
}

/* ---------- app ---------- */
export function OpsDashboard() {
  const [snap, setSnap] = useState<OpsSnapshot | null>(null);
  const snapRef = useRef<OpsSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.opsSnapshot();
        if (!alive) return;
        snapRef.current = s;
        setSnap(s);
      } catch {
        /* keep last good snapshot on error */
      }
    };
    load();
    const id = setInterval(load, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!snap) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--paper-2)", display: "grid", placeItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink-3)" }}>
          <Spinner /> <span style={{ fontSize: 14, fontWeight: 600 }}>Loading operations…</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper-2)" }}>
      <div className="mm-ops-wrap">
        {/* top bar */}
        <div className="mm-ops-top">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Logo size={24} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, color: "var(--ink-2)", borderLeft: "1px solid var(--line)", paddingLeft: 16 }}>Operations</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="pill" style={{ fontSize: 10.5 }}>
              <span className="dot" style={{ background: "var(--recv)", animation: "pulse 1.4s infinite" }} />live · 2s
            </span>
            <Link to="/" className="btn btn-ghost" style={{ padding: "8px 13px", fontSize: 13, textDecoration: "none" }}>← Home</Link>
          </div>
        </div>

        {/* KPI strip */}
        <div className="mm-ops-kpis">
          <Kpi label="In flight" value={fmt(snap.inFlight)} />
          <Kpi label="Delivered today" value={fmt(snap.deliveredToday)} />
          <Kpi label="Failed today" value={fmt(snap.failedToday)} />
          <Kpi label="Payout float" value={fmt(snap.floatXaf)} unit="XAF" />
        </div>

        {/* main grid */}
        <div className="mm-ops-grid">
          <TxTable rows={snap.rows} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <RailHealth rails={snap.rails} />
          </div>
        </div>
      </div>

      {/* scoped layout (prototype shell classes are not in the global stylesheet) */}
      <style>{`
        .mm-ops-wrap { max-width: 1320px; margin: 0 auto; padding: 16px clamp(14px, 2.5vw, 30px) 50px; }
        .mm-ops-top { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px 20px; flex-wrap: wrap; gap: 12px; }
        .mm-ops-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
        .mm-ops-grid { display: grid; grid-template-columns: minmax(0,1fr) 348px; gap: 16px; align-items: start; }
        @media (max-width: 1000px) { .mm-ops-grid { grid-template-columns: 1fr; } .mm-ops-kpis { grid-template-columns: repeat(2,1fr); } }
        @media (max-width: 560px) { .mm-ops-kpis { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

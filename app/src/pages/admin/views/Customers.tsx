/* ============================================================
   Customers — profiles, verification, risk. From api.adminCustomers().
   Row → identity drawer (keyboard-accessible <button> rows).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { AdminCustomer } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { Flag } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { Bar, Card, KV, Pill, SectionTitle, SegToggle } from "../AdminUI.js";
import { useAdmin } from "../context.js";
import { Failed, Loading } from "./Overview.js";

const COLS = "1.5fr 1fr 1fr 0.8fr 1fr 1fr 0.7fr";
const FILTERS = ["All", "Verified", "Pending", "Rejected"] as const;

function riskTone(risk: number) {
  return risk > 50 ? "bad" : risk > 25 ? "warn" : "recv";
}

export function CustomersView() {
  const { query } = useAdmin();
  const [rows, setRows] = useState<AdminCustomer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [sel, setSel] = useState<AdminCustomer | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminCustomers()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setErr("Couldn't load customers."); });
    return () => { alive = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (rows ?? []).filter((r) => {
      if (filter !== "All" && r.verification !== filter) return false;
      if (!q) return true;
      return [r.phone, r.id, COUNTRIES[r.country].name].some((f) => f.toLowerCase().includes(q));
    }),
    [rows, filter, q],
  );

  if (err) return <Failed t="Customers" msg={err} />;
  if (!rows) return <Loading t="Customers" s="Profiles, verification and risk." />;

  return (
    <div>
      <SectionTitle t="Customers" s="Profiles, verification and risk." />
      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <SegToggle options={[...FILTERS]} value={filter} onChange={setFilter} />
        {q && <span className="pill" style={{ fontSize: 11.5 }}>“{query}” · {filtered.length}</span>}
      </div>
      <Card pad={false}>
        <div className="mm-tablewrap">
          <div className="mm-table">
            <div style={{ display: "grid", gridTemplateColumns: COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
              <span>Phone</span><span>Country</span><span>Verification</span><span>Txns</span><span>Volume</span><span>Risk</span><span></span>
            </div>
            {filtered.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No customers match this view.</div>}
            {filtered.map((r) => (
              <button key={r.id} type="button" onClick={() => setSel(r)}
                style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", padding: "12px 20px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line-2)", font: "inherit", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.phone}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}><Flag country={r.country} size={14} />{COUNTRIES[r.country].name}</span>
                <Pill status={r.verification} />
                <span className="num" style={{ fontSize: 13 }}>{r.txns}</span>
                <span className="num" style={{ fontSize: 13 }}>{fmt(r.volumeXaf / 1_000_000, 1)}M XAF</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700, color: r.risk > 50 ? "var(--bad)" : r.risk > 25 ? "var(--warn)" : "var(--recv)" }}>{r.risk}</span>
                  <span style={{ width: 40 }}><Bar pct={r.risk} tone={riskTone(r.risk)} /></span>
                </span>
                <span style={{ textAlign: "right", fontSize: 12, fontWeight: 650, color: "var(--accent)" }}>Review</span>
              </button>
            ))}
          </div>
        </div>
      </Card>
      {sel && <CustomerDrawer c={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

/* ---------- identity / customer drawer ---------- */
function CustomerDrawer({ c, onClose }: { c: AdminCustomer; onClose: () => void }) {
  const { goTo } = useAdmin();
  const addr = c.phone.replace(/[^0-9]/g, "").slice(-9) + "@momome.africa";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0.2 0.01 64 / 0.42)", border: "none", cursor: "pointer" }} />
      <div role="dialog" aria-label={`Customer ${c.phone}`} style={{ position: "absolute", top: 0, right: 0, height: "100vh", width: "min(420px, 92vw)", background: "var(--surface)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", overflowY: "auto", animation: "slideL .25s ease" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Flag country={c.country} size={18} />
                <span className="num" style={{ fontSize: 16, fontWeight: 750, whiteSpace: "nowrap" }}>{c.phone}</span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{c.id} · {COUNTRIES[c.country].name}</div>
            </div>
            <button type="button" onClick={onClose} className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
            <Pill status={c.verification} />
            <span className="pill" style={{ fontSize: 11 }}>Risk {c.risk}</span>
          </div>
        </div>
        <div style={{ padding: "8px 22px 24px" }}>
          <div style={{ marginTop: 16, padding: 14, borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Lightning identity</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginTop: 4 }}>{addr}</div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 4 }}>Customer record</div>
            <KV k="Customer ID" v={c.id} />
            <KV k="Mobile number" v={c.phone} />
            <KV k="Country" v={COUNTRIES[c.country].name} />
            <KV k="Verification" v={c.verification} tone={c.verification === "Verified" ? "recv" : c.verification === "Rejected" ? "bad" : "warn"} />
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 4 }}>Activity & risk</div>
            <KV k="Transactions" v={c.txns} />
            <KV k="Lifetime volume" v={`${fmt(c.volumeXaf)} XAF`} />
            <KV k="Risk score" v={c.risk} tone={riskTone(c.risk)} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => { goTo("payments", c.phone); onClose(); }}>View payment history</button>
          </div>
        </div>
      </div>
    </div>
  );
}

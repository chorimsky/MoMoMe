/* ============================================================
   MoMoMe — Operations dashboard
   ============================================================ */
const { useState, useEffect, useRef } = React;

const STATUS = {
  received:   { label: "Received",    color: "var(--send)",  dot: "var(--send)" },
  converting: { label: "Converting",  color: "var(--info)",  dot: "var(--info)" },
  payout:     { label: "Paying out",  color: "var(--warn)",  dot: "var(--warn)" },
  delivered:  { label: "Delivered",   color: "var(--recv)",  dot: "var(--recv)" },
  failed:     { label: "Failed",      color: "var(--bad)",   dot: "var(--bad)" },
};
const FLOW = ["received", "converting", "payout", "delivered"];

const NAMES = ["A. Mbarga", "F. Nkemleke", "J. Owono", "C. Diallo", "L. Tchami", "S. Etoa", "P. Ngassa", "R. Biya", "M. Fotso", "G. Manga", "K. Abena", "T. Eyong", "D. Ndongo", "B. Sako"];
const rid = () => "MM" + Math.random().toString(36).slice(2, 9).toUpperCase();
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function makeTx(ageSec) {
  const asset = Math.random() > 0.45 ? "USDT" : "BTC";
  const country = pick(["CM", "CM", "CM", "GA", "TD", "CG"]);
  const provider = pick(COUNTRIES[country].providers);
  const xaf = pick([15000, 25000, 30000, 50000, 75000, 100000, 120000, 200000, 250000]);
  const usd = xaf / 600;
  return {
    id: rid(), name: pick(NAMES), asset, country, provider, xaf, usd,
    sats: Math.round(usd / 96000 * 1e8), usdt: +(usd * 1.015).toFixed(2),
    status: "delivered", age: ageSec, live: false,
  };
}

function timeAgo(s) {
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h ago";
}

/* ---------------- KPI card ---------------- */
function Kpi({ label, value, unit, delta, spark }) {
  return (
    <div className="card" style={{ padding: "16px 18px", borderRadius: "var(--r)" }}>
      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 700, color: "var(--ink-3)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <span className="num" style={{ fontSize: 27, fontWeight: 750, letterSpacing: "-0.02em" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-3)" }}>{unit}</span>}
      </div>
      {delta != null && (
        <div style={{ fontSize: 12, fontWeight: 600, color: delta >= 0 ? "var(--recv)" : "var(--bad)", marginTop: 4 }}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>vs yesterday</span>
        </div>
      )}
      {spark && <Spark data={spark} />}
    </div>
  );
}
function Spark({ data }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${28 - ((d - min) / (max - min || 1)) * 24 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" style={{ width: "100%", height: 28, marginTop: 8, display: "block" }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- transactions table ---------------- */
function TxTable({ rows }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ fontSize: 16 }}>Live transactions</h3>
          <span className="pill" style={{ fontSize: 10.5 }}><span className="dot" style={{ background: "var(--recv)", animation: "pulse 1.4s infinite" }} />streaming</span>
        </div>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{rows.length} shown</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.1fr 1fr 0.9fr", gap: 0, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, color: "var(--ink-3)", padding: "0 20px 8px", borderBottom: "1px solid var(--line)" }}>
        <span>Recipient</span><span>Asset in</span><span>Payout</span><span>Status</span><span style={{ textAlign: "right" }}>Time</span>
      </div>
      <div style={{ maxHeight: 560, overflowY: "auto" }}>
        {rows.map((t) => (
          <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.1fr 1fr 0.9fr", gap: 0, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)", animation: t.live ? "fadeUp .4s ease both" : "none", background: t.live ? "var(--accent-wash)" : "transparent", transition: "background 1s" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}>
                <Flag country={t.country} size={14} /> {t.name}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{t.id}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AssetGlyph kind={t.asset} size={24} />
              <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{t.asset === "BTC" ? fmt(t.sats) : "$" + fmt(t.usdt, 2)}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="num" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--recv)" }}>{fmt(t.xaf)} XAF</div>
              <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{PROVIDERS[t.provider].name}</div>
            </div>
            <div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: STATUS[t.status].color, whiteSpace: "nowrap" }}>
                <span className="dot" style={{ background: STATUS[t.status].dot, animation: t.status !== "delivered" && t.status !== "failed" ? "pulse 1.2s infinite" : "none" }} />
                {STATUS[t.status].label}
              </span>
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>{timeAgo(t.age)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- rails health ---------------- */
function RailHealth() {
  const rails = [
    { name: "IBEX · Lightning", rail: "IBEX", status: "Operational", lat: "120ms", up: "99.98%", ok: true },
    { name: "TRON · TRC20 node", rail: "TRON", status: "Operational", lat: "1.4s", up: "99.95%", ok: true },
    { name: "FX Engine", rail: "FX", status: "Operational", lat: "12ms", up: "100%", ok: true },
    { name: "PawaPay payout", rail: "PawaPay", status: "Degraded · Orange", lat: "4.2s", up: "98.6%", ok: false },
  ];
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Rail health</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {rails.map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span className="dot" style={{ width: 8, height: 8, background: r.ok ? "var(--recv)" : "var(--warn)", boxShadow: `0 0 0 3px ${r.ok ? "var(--recv-wash)" : "var(--send-wash)"}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 13 }}>{r.name}</div>
              <div className="mono" style={{ fontSize: 10.5, color: r.ok ? "var(--ink-3)" : "var(--warn)" }}>{r.status}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="num" style={{ fontSize: 12, fontWeight: 600 }}>{r.lat}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{r.up}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- liquidity / treasury ---------------- */
function Float({ label, glyph, value, sub, pct, tone }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: tone, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, flex: "none" }}>{glyph}</span>
        <span style={{ fontWeight: 650, fontSize: 13, flex: 1 }}>{label}</span>
        <span className="num" style={{ fontSize: 13.5, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 4, background: tone }} />
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 5 }}>{sub}</div>
    </div>
  );
}
function Treasury() {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h3 style={{ fontSize: 15 }}>Treasury float</h3>
        <span className="pill" style={{ fontSize: 10.5, color: "var(--recv)", borderColor: "var(--recv)" }}>balanced</span>
      </div>
      <Float label="Bitcoin" glyph="₿" value="0.84 BTC" sub="≈ $80,640 · inbound buffer 62%" pct={62} tone="var(--lightning)" />
      <Float label="USDT (TRC20)" glyph="₮" value="118,400" sub="≈ $118,400 · inbound buffer 74%" pct={74} tone="oklch(0.62 0.13 162)" />
      <Float label="XAF payout pool" glyph="₣" value="42.6M" sub="≈ $71,000 · 4.1h runway" pct={41} tone="var(--recv)" />
      <button className="btn btn-ghost" style={{ width: "100%", marginTop: 14, fontSize: 13.5, padding: "11px", whiteSpace: "nowrap" }}>⇄ Rebalance pool</button>
    </div>
  );
}

/* ---------------- app ---------------- */
function App() {
  const [rows, setRows] = useState(() => {
    const r = [];
    let age = 4;
    for (let i = 0; i < 14; i++) { const t = makeTx(age); age += Math.floor(Math.random() * 90) + 20; t.status = i < 3 ? FLOW[Math.floor(Math.random() * 3)] : "delivered"; if (Math.random() < 0.05) t.status = "failed"; r.push(t); }
    return r;
  });
  const [clock, setClock] = useState(new Date());

  useInterval(() => setClock(new Date()), 1000);
  useInterval(() => setRows((rs) => rs.map((t) => ({ ...t, age: t.age + 1 }))), 1000);

  // advance in-flight statuses
  useInterval(() => {
    setRows((rs) => rs.map((t) => {
      if (t.status === "delivered" || t.status === "failed") return t;
      const i = FLOW.indexOf(t.status);
      if (i < FLOW.length - 1 && Math.random() > 0.4) return { ...t, status: FLOW[i + 1], live: false };
      return { ...t, live: false };
    }));
  }, 1800);

  // inject new tx
  useInterval(() => {
    setRows((rs) => {
      const t = makeTx(0); t.status = "received"; t.live = true;
      return [t, ...rs].slice(0, 22);
    });
  }, 4200);

  const dayVol = 248_500_000;
  return (
    <div className="ops-wrap">
      <div className="ops-top">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Logo size={24} />
          <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, color: "var(--ink-2)", borderLeft: "1px solid var(--line)", paddingLeft: 16 }}>Operations</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{clock.toLocaleTimeString("en-GB")} WAT</span>
          <nav className="ops-nav">
            <a href="MoMoMe Send Flow.html">Send</a>
            <a className="on" href="MoMoMe Ops Dashboard.html">Ops</a>
            <a href="MoMoMe Architecture.html">Architecture</a>
          </nav>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Volume today" value="248.5M" unit="XAF" delta={12} spark={[180, 195, 188, 210, 205, 230, 226, 248]} />
        <Kpi label="Transactions" value="1,284" delta={8} spark={[60, 72, 80, 76, 95, 110, 120, 128]} />
        <Kpi label="Success rate" value="99.2" unit="%" delta={0.4} spark={[98.4, 98.9, 99.1, 98.8, 99.0, 99.3, 99.1, 99.2]} />
        <Kpi label="Avg settle time" value="6.4" unit="sec" delta={-14} spark={[9.1, 8.7, 8.2, 7.6, 7.1, 6.9, 6.6, 6.4]} />
      </div>

      <div className="grid">
        <TxTable rows={rows} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <RailHealth />
          <Treasury />
        </div>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

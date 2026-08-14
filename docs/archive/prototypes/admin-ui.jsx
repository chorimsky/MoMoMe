/* ============================================================
   MoMo›Me Admin — shared UI helpers (→ window)
   ============================================================ */
const { useState: useStateU } = React;

const STATUS_TONE = {
  Completed: "recv", Delivered: "recv", Verified: "recv", Online: "recv", Connected: "recv", Active: "recv", Paid: "recv", Synced: "recv",
  Processing: "info", Pending: "warn", Maintenance: "warn", Review: "warn", "Medium Risk": "warn", Sandbox: "warn",
  Failed: "bad", Offline: "bad", Rejected: "bad", Disconnected: "bad", "High Risk": "bad", Suspended: "bad", Low: "recv",
  "Low Risk": "recv", Production: "recv",
};
function toneColor(t) {
  return { recv: "var(--recv)", info: "var(--info)", warn: "var(--warn)", bad: "var(--bad)", ink: "var(--ink-2)" }[t] || "var(--ink-2)";
}
function toneWash(t) {
  return { recv: "var(--recv-wash)", info: "oklch(0.95 0.03 250)", warn: "var(--send-wash)", bad: "var(--bad-wash)" }[t] || "var(--surface-2)";
}

function Pill({ status, tone }) {
  const tn = tone || STATUS_TONE[status] || "ink";
  const c = toneColor(tn);
  const animate = status === "Processing" || status === "Pending";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: c, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, animation: animate ? "pulse 1.2s infinite" : "none" }} />
      {status}
    </span>
  );
}

function AKpi({ label, value, unit, delta, tone, spark }) {
  return (
    <div className="card" style={{ padding: "15px 17px", borderRadius: "var(--r)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 700, color: "var(--ink-3)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 8 }}>
        <span className="num" style={{ fontSize: 25, fontWeight: 750, letterSpacing: "-0.02em", color: tone ? toneColor(tone) : "var(--ink)" }}>{value}</span>
        {unit && <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-3)" }}>{unit}</span>}
      </div>
      {delta != null && (
        <div style={{ fontSize: 11.5, fontWeight: 600, color: delta >= 0 ? "var(--recv)" : "var(--bad)", marginTop: 4 }}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>vs last week</span>
        </div>
      )}
      {spark && <Spark data={spark} />}
    </div>
  );
}

function Spark({ data, tone = "accent", h = 30 }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${h - ((d - min) / (max - min || 1)) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, marginTop: 8, display: "block" }}>
      <polyline points={pts} fill="none" stroke={`var(--${tone})`} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({ title, sub, action, children, pad = true, style }) {
  return (
    <div className="card" style={{ padding: pad ? "18px 20px" : 0, overflow: "hidden", ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: title ? 16 : 0, padding: pad ? 0 : "18px 20px 12px" }}>
          <div>
            {title && <h3 style={{ fontSize: 15.5 }}>{title}</h3>}
            {sub && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Bar({ pct, tone = "accent" }) {
  return (
    <div style={{ height: 7, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
      <div style={{ width: Math.min(100, pct) + "%", height: "100%", borderRadius: 4, background: `var(--${tone})` }} />
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={on}
      style={{ width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", padding: 3, background: on ? "var(--recv)" : "var(--line)", transition: "background .2s", display: "flex" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-sm)", transform: on ? "translateX(18px)" : "none", transition: "transform .2s" }} />
    </button>
  );
}

function Field({ label, value, mono, wide }) {
  return (
    <label style={{ display: "block", gridColumn: wide ? "1 / -1" : "auto" }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>{label}</span>
      <input defaultValue={value} className={mono ? "mono" : ""}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 13.5, color: "var(--ink)", outline: "none", fontFamily: mono ? "var(--font-mono)" : "inherit" }} />
    </label>
  );
}

function SegToggle({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 9, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={{ cursor: "pointer", border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 650, fontFamily: "inherit",
          background: value === o ? "var(--surface)" : "transparent", color: value === o ? "var(--ink)" : "var(--ink-3)", boxShadow: value === o ? "var(--shadow-sm)" : "none" }}>{o}</button>
      ))}
    </div>
  );
}

Object.assign(window, { Pill, AKpi, Spark, Card, Bar, Toggle, Field, SegToggle, STATUS_TONE, toneColor, toneWash });

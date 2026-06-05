/* ============================================================
   MoMo›Me Admin — shared UI atoms (ported from admin-ui.jsx)
   ============================================================ */
import type { CSSProperties, ReactNode } from "react";

export type Tone = "recv" | "info" | "warn" | "bad" | "ink" | "accent" | "lightning";

const STATUS_TONE: Record<string, Tone> = {
  Completed: "recv", Delivered: "recv", Verified: "recv", Online: "recv", Connected: "recv", Active: "recv", Paid: "recv", Synced: "recv", Production: "recv", Claimed: "recv",
  Processing: "info", Pending: "warn", Maintenance: "warn", Review: "warn", "Medium Risk": "warn", Sandbox: "warn",
  Failed: "bad", Offline: "bad", Rejected: "bad", Disconnected: "bad", "High Risk": "bad", Suspended: "bad",
  Low: "recv", "Low Risk": "recv",
};

export function toneColor(t: Tone | undefined): string {
  return { recv: "var(--recv)", info: "var(--info)", warn: "var(--warn)", bad: "var(--bad)", accent: "var(--accent)", lightning: "var(--lightning)", ink: "var(--ink-2)" }[t ?? "ink"] ?? "var(--ink-2)";
}
export function toneWash(t: Tone): string {
  return { recv: "var(--recv-wash)", info: "var(--info-wash)", warn: "var(--send-wash)", bad: "var(--bad-wash)", accent: "var(--accent-wash)", lightning: "var(--accent-wash)", ink: "var(--surface-2)" }[t] ?? "var(--surface-2)";
}

export function Pill({ status, tone }: { status: string; tone?: Tone }) {
  const tn = tone ?? STATUS_TONE[status] ?? "ink";
  const c = toneColor(tn);
  const animate = status === "Processing" || status === "Pending";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: c, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, animation: animate ? "pulse 1.2s infinite" : "none" }} />
      {status}
    </span>
  );
}

export function AKpi({ label, value, unit, delta, tone, spark }: { label: string; value: ReactNode; unit?: string; delta?: number; tone?: Tone; spark?: number[] }) {
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

export function Spark({ data, tone = "accent", h = 30 }: { data: number[]; tone?: Tone; h?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((d, i) => `${(i / (data.length - 1 || 1)) * 100},${h - ((d - min) / (max - min || 1)) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, marginTop: 8, display: "block" }}>
      <polyline points={pts} fill="none" stroke={`var(--${tone})`} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Card({ title, sub, action, children, pad = true, style }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode; pad?: boolean; style?: CSSProperties }) {
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

export function Bar({ pct, tone = "accent" }: { pct: number; tone?: Tone }) {
  return (
    <div style={{ height: 7, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
      <div style={{ width: Math.min(100, pct) + "%", height: "100%", borderRadius: 4, background: `var(--${tone})` }} />
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={on}
      style={{ width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", padding: 3, background: on ? "var(--recv)" : "var(--ink-3)", transition: "background .2s", display: "flex" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-sm)", transform: on ? "translateX(18px)" : "none", transition: "transform .2s" }} />
    </button>
  );
}

export function Field({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <label style={{ display: "block", gridColumn: wide ? "1 / -1" : "auto" }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>{label}</span>
      <input defaultValue={value} aria-label={label} className={mono ? "mono" : ""}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 13.5, color: "var(--ink)", outline: "none", fontFamily: mono ? "var(--font-mono)" : "inherit" }} />
    </label>
  );
}

export function SegToggle({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 9, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} style={{ cursor: "pointer", border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 650, fontFamily: "inherit",
          background: value === o ? "var(--surface)" : "transparent", color: value === o ? "var(--ink)" : "var(--ink-3)", boxShadow: value === o ? "var(--shadow-sm)" : "none" }}>{o}</button>
      ))}
    </div>
  );
}

/* ---------- layout primitives shared across views ---------- */
export function SectionTitle({ t, s }: { t: string; s?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 21 }}>{t}</h2>
      {s && <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginTop: 4 }}>{s}</p>}
    </div>
  );
}

export function Grid({ cols, gap = 14, children, style }: { cols: number; gap?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="mm-grid" data-cols={cols} style={{ ["--mm-cols" as string]: String(cols), gap, ...style } as CSSProperties}>
      {children}
    </div>
  );
}

export function KV({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: Tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
      <span style={{ fontSize: 13, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{k}</span>
      <span className="num" style={{ fontSize: 13.5, fontWeight: 650, textAlign: "right", color: tone ? toneColor(tone) : "var(--ink)", whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

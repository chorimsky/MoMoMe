import { useEffect, useState, type ReactNode } from "react";

/** Live countdown to an ISO expiry. Ticks every second. */
export function useExpiry(iso: string): { secondsLeft: number; expired: boolean; label: string } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return { secondsLeft, expired: secondsLeft <= 0, label: `${m}:${String(s).padStart(2, "0")}` };
}

export function FlowCard({ children }: { children: ReactNode }) {
  return <div className="card" style={{ padding: "var(--pad)", boxShadow: "var(--shadow-sm)", animation: "riseIn .32s ease" }}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 8 }}>{children}</div>;
}

export function Stepper({ i }: { i: number }) {
  const steps = ["Details", "Method", "Review", "Pay"];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
      {steps.map((s, n) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, flex: n < steps.length - 1 ? 1 : "none" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".02em", color: n === i ? "var(--accent)" : n < i ? "var(--ink-2)" : "var(--ink-3)" }}>{s}</span>
          {n < steps.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, background: n < i ? "var(--recv)" : "var(--line)" }} />}
        </div>
      ))}
    </div>
  );
}

export function Row({ k, v, sub, strong, tone }: { k: string; v: string; sub?: string; strong?: boolean; tone?: "recv" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, padding: "10px 0" }}>
      <span style={{ fontSize: 14, color: "var(--ink-2)", fontWeight: strong ? 700 : 500, whiteSpace: "nowrap" }}>{k}</span>
      <span style={{ textAlign: "right", minWidth: 0 }}>
        <span className="num" style={{ fontSize: strong ? 17 : 14, fontWeight: strong ? 750 : 600, color: tone === "recv" ? "var(--recv)" : "var(--ink)", whiteSpace: "nowrap" }}>{v}</span>
        {sub && <span className="num" style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{sub}</span>}
      </span>
    </div>
  );
}

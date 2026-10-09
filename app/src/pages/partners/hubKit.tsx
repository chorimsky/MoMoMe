/* ============================================================
   The handful of MoMo›Me design-system primitives the Sorted hub uses that
   the app doesn't export as components yet (it styles them with classes).
   Mirrors the Claude Design system bundle so the port renders identically.
   ============================================================ */
import type { CSSProperties, ReactNode } from "react";

/* Inline CSS text → a React style object. The ported template keeps its styles
   as CSS strings (with interpolated tokens), so parse once and memoise. */
const cssCache = new Map<string, CSSProperties>();
export function css(text: string): CSSProperties {
  const hit = cssCache.get(text);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const decl of text.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop || !val) continue;
    out[prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = val;
  }
  if (cssCache.size > 2000) cssCache.clear();
  cssCache.set(text, out as CSSProperties);
  return out as CSSProperties;
}

export function Button({ variant = "primary", size = "md", block = false, disabled = false, children, style, onClick }: {
  variant?: string; size?: "sm" | "md" | "lg"; block?: boolean; disabled?: boolean; children?: ReactNode; style?: CSSProperties; onClick?: () => void;
}) {
  const sz = size === "sm" ? { padding: "8px 14px", fontSize: 13.5 } : size === "lg" ? { padding: "16px 28px", fontSize: 16 } : {};
  return (
    <button type="button" className={`btn btn-${variant}`} disabled={disabled} onClick={onClick}
      style={{ ...sz, ...(block ? { width: "100%", padding: "16px 22px", minHeight: 44 } : null), ...style }}>
      {children}
    </button>
  );
}

export function Chip({ active = false, children, onClick }: { active?: boolean; children?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, padding: "10px 14px",
      borderRadius: 999, border: `1.5px solid ${active ? "var(--accent)" : "var(--line)"}`,
      background: active ? "var(--accent-wash)" : "var(--surface)", color: active ? "var(--ink)" : "var(--ink-2)",
      fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap",
      transition: "transform .12s ease, border-color .16s ease, background .16s ease, color .16s ease",
    }}>{children}</button>
  );
}

const PILL_TONES: Record<string, [string, string, string]> = {
  neutral: ["var(--surface-2)", "var(--ink-2)", "var(--line)"],
  recv: ["var(--recv-wash)", "var(--recv)", "transparent"],
  brand: ["var(--brand-wash)", "var(--brand-ink)", "var(--brand)"],
  warn: ["var(--send-wash)", "var(--warn-ink)", "var(--warn)"],
  bad: ["var(--bad-wash)", "var(--bad)", "transparent"],
  accent: ["var(--accent-wash)", "var(--accent)", "transparent"],
};
export function Pill({ children, tone = "neutral", dot = false }: { children?: ReactNode; tone?: string; dot?: boolean }) {
  const t = PILL_TONES[tone] ?? PILL_TONES.neutral;
  return (
    <span className="pill" style={{ background: t[0], color: t[1], borderColor: t[2] }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flex: "none" }} />}
      {children}
    </span>
  );
}

export function Segmented({ options = [], value, onChange }: { options?: string[]; value?: string; onChange?: (o: string) => void }) {
  return (
    <div role="tablist" style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} type="button" role="tab" aria-selected={on} onClick={() => onChange?.(o)} style={{
            flex: 1, minHeight: 40, padding: "8px 14px", border: 0, borderRadius: 999,
            background: on ? "var(--surface)" : "transparent", color: on ? "var(--ink)" : "var(--ink-2)",
            boxShadow: on ? "var(--shadow-sm)" : "none", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5,
            cursor: "pointer", whiteSpace: "nowrap",
          }}>{o}</button>
        );
      })}
    </div>
  );
}

const NOTICE_TONES: Record<string, [string, string, string]> = {
  warn: ["var(--warn)", "var(--send-wash)", "var(--ink)"],
  bad: ["var(--bad)", "var(--bad-wash)", "var(--bad)"],
  info: ["var(--line)", "var(--surface-2)", "var(--ink-2)"],
  recv: ["var(--recv)", "var(--recv-wash)", "var(--ink)"],
};
export function Notice({ tone = "warn", children }: { tone?: string; children?: ReactNode }) {
  const t = NOTICE_TONES[tone] ?? NOTICE_TONES.warn;
  return (
    <div role={tone === "bad" ? "alert" : "note"} style={{
      padding: "10px 12px", borderRadius: 10, border: `1px solid ${t[0]}`, background: t[1], color: t[2],
      fontSize: 12.5, fontWeight: tone === "bad" ? 600 : 500, lineHeight: 1.45,
    }}>{children}</div>
  );
}

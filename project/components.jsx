/* ============================================================
   MoMoMe — shared React atoms  (exported to window)
   Load AFTER React/Babel, BEFORE page scripts.
   ============================================================ */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------- helpers ---------- */
function useInterval(fn, ms, on = true) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

function fmt(n, d = 0) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtXAF(n) { return fmt(Math.round(n)) + " XAF"; }
function fmtSats(n) { return fmt(Math.round(n)) + " sats"; }

/* count-up number */
function Amount({ value, decimals = 0, suffix = "", className = "", dur = 600 }) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(); const a = from.current, b = value;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{fmt(v, decimals)}{suffix}</span>;
}

/* ---------- brand mark ---------- */
function Logo({ size = 26, withWord = true, mono = false }) {
  const c = mono ? "currentColor" : "var(--accent)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.34 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: "none" }}>
        <circle cx="16" cy="16" r="14" fill={c} />
        <path d="M13 10 L19.5 16 L13 22" fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withWord && (
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: size * 0.74, letterSpacing: "-0.02em", color: "var(--ink)" }}>
          MoMo<span style={{ color: "var(--accent)", fontWeight: 600, margin: "0 0.02em" }}>›</span>Me
        </span>
      )}
    </span>
  );
}

/* ---------- fake-but-convincing QR ---------- */
function QR({ value = "", size = 188, fg = "#1a1714", bg = "#ffffff" }) {
  const ref = useRef(null);
  useEffect(() => {
    const N = 33, cv = ref.current, ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr; cv.height = size * dpr; ctx.scale(dpr, dpr);
    const cell = size / N;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
    // deterministic hash from value
    let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
    const isFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
    ctx.fillStyle = fg;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (isFinder(r, c)) continue;
      if (rnd() > 0.52) ctx.fillRect(Math.round(c * cell), Math.round(r * cell), Math.ceil(cell), Math.ceil(cell));
    }
    const finder = (R, C) => {
      ctx.fillStyle = fg; ctx.fillRect(C * cell, R * cell, cell * 7, cell * 7);
      ctx.fillStyle = bg; ctx.fillRect((C + 1) * cell, (R + 1) * cell, cell * 5, cell * 5);
      ctx.fillStyle = fg; ctx.fillRect((C + 2) * cell, (R + 2) * cell, cell * 3, cell * 3);
    };
    finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  }, [value, size, fg, bg]);
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: 10, display: "block" }} />;
}

/* ---------- asset / rail glyphs ---------- */
function AssetGlyph({ kind, size = 30 }) {
  const isBtc = kind === "BTC";
  return (
    <span style={{
      width: size, height: size, borderRadius: 9, flex: "none",
      display: "inline-grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700,
      fontSize: size * 0.5, color: "#fff",
      background: isBtc ? "var(--lightning)" : "oklch(0.62 0.13 162)",
    }}>{isBtc ? "₿" : "₮"}</span>
  );
}

function RailBadge({ rail }) {
  const map = {
    IBEX:    { label: "IBEX · Lightning", color: "var(--lightning)", glyph: "⚡" },
    TRON:    { label: "TRON · TRC20",     color: "var(--tron)",      glyph: "◆" },
    PawaPay: { label: "PawaPay",          color: "var(--recv)",      glyph: "◎" },
    FX:      { label: "FX Engine",        color: "var(--info)",      glyph: "⇄" },
  };
  const m = map[rail] || map.IBEX;
  return (
    <span className="pill" style={{ background: "var(--surface)" }}>
      <span style={{ color: m.color, fontSize: 13, lineHeight: 1 }}>{m.glyph}</span>
      <span className="mono" style={{ fontSize: 11, letterSpacing: 0, whiteSpace: "nowrap" }}>{m.label}</span>
    </span>
  );
}

/* ---------- mobile-money providers (generic, not trademarked art) ---------- */
const PROVIDERS = {
  MTN:    { name: "MTN MoMo",     color: "oklch(0.83 0.16 92)",  ink: "#1a1400", short: "MTN" },
  ORANGE: { name: "Orange Money", color: "oklch(0.70 0.18 48)",  ink: "#1a0c00", short: "OM" },
  AIRTEL: { name: "Airtel Money", color: "oklch(0.55 0.20 22)",  ink: "#fff",    short: "AT" },
};
function ProviderChip({ id, size = "md", active, onClick }) {
  const p = PROVIDERS[id]; if (!p) return null;
  const big = size === "lg";
  return (
    <button type="button" onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 9, cursor: onClick ? "pointer" : "default",
        padding: big ? "11px 14px" : "7px 11px", borderRadius: 11, font: "inherit",
        background: active ? "var(--surface)" : "var(--surface-2)",
        border: `1.5px solid ${active ? "var(--accent)" : "var(--line)"}`,
        boxShadow: active ? "var(--shadow-sm)" : "none", transition: "all .15s", width: onClick ? "100%" : "auto",
      }}>
      <span style={{ width: big ? 30 : 24, height: big ? 30 : 24, borderRadius: 7, flex: "none", background: p.color, color: p.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: big ? 12 : 10, fontFamily: "var(--font-mono)" }}>{p.short}</span>
      <span style={{ fontWeight: 600, fontSize: big ? 15 : 13, color: "var(--ink)", whiteSpace: "nowrap" }}>{p.name}</span>
      {onClick && active && <span style={{ marginLeft: "auto", color: "var(--accent)", fontWeight: 800 }}>✓</span>}
    </button>
  );
}

function Flag({ country, size = 18 }) {
  // simple tri-band placeholder flags (Cameroon / Gabon / Chad / Congo)
  const bands = {
    CM: ["#007a5e", "#ce1126", "#fcd116"],
    GA: ["#009e60", "#fcd116", "#3a75c4"],
    TD: ["#002664", "#fecb00", "#c60c30"],
    CG: ["#009543", "#fbde4a", "#dc241f"],
    CF: ["#003082", "#ffffff", "#289728"],
  }[country] || ["#007a5e", "#ce1126", "#fcd116"];
  return (
    <span style={{ display: "inline-flex", width: size * 1.4, height: size, borderRadius: 3, overflow: "hidden", flex: "none", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }}>
      {bands.map((b, i) => <span key={i} style={{ flex: 1, background: b }} />)}
    </span>
  );
}

const COUNTRIES = {
  CM: { name: "Cameroon", code: "CM", dial: "+237", ccy: "XAF", providers: ["MTN", "ORANGE"] },
  GA: { name: "Gabon",    code: "GA", dial: "+241", ccy: "XAF", providers: ["AIRTEL", "MTN"] },
  TD: { name: "Chad",     code: "TD", dial: "+235", ccy: "XAF", providers: ["AIRTEL", "MTN"] },
  CG: { name: "Congo",    code: "CG", dial: "+242", ccy: "XAF", providers: ["MTN", "AIRTEL"] },
  CF: { name: "Cent. Afr. Rep.", code: "CF", dial: "+236", ccy: "XAF", providers: ["ORANGE", "MTN"] },
};

/* ---------- copy-to-clipboard field ---------- */
function CopyField({ value, label, mono = true }) {
  const [done, setDone] = useState(false);
  const copy = () => { try { navigator.clipboard.writeText(value); } catch (e) {} setDone(true); setTimeout(() => setDone(false), 1400); };
  return (
    <button type="button" onClick={copy} title="Copy"
      style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", font: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        {label && <span style={{ display: "block", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", fontWeight: 700, marginBottom: 2 }}>{label}</span>}
        <span className={mono ? "mono" : ""} style={{ fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{value}</span>
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: done ? "var(--recv)" : "var(--accent)", flex: "none" }}>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

/* ---------- spinner / status dot ---------- */
function Spinner({ size = 18, color = "var(--accent)" }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", border: `2px solid color-mix(in oklab, ${color} 25%, transparent)`, borderTopColor: color, display: "inline-block", animation: "spin .7s linear infinite", flex: "none" }} />;
}

Object.assign(window, {
  useInterval, fmt, fmtXAF, fmtSats, Amount,
  Logo, QR, AssetGlyph, RailBadge, ProviderChip, PROVIDERS, Flag, COUNTRIES, CopyField, Spinner,
});

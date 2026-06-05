/* ============================================================
   Shared visual atoms (ported from the prototype's components.jsx).
   QR is now a REAL, scannable code via the `qrcode` lib — the
   prototype drew random pixels (BACKEND/FRONTEND review finding).
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import type { CountryCode, ProviderId, Method } from "@shared/types.js";
import { PROVIDERS } from "@shared/domain.js";
import { fmt } from "../lib/format.js";

/* ---------- brand mark ---------- */
/** The MoMoMe lightning bolt — green, sits between "MoMo" and "Me". */
function Bolt({ h, color }: { h: number; color: string }) {
  return (
    <svg height={h} width={h * 0.46} viewBox="0 0 23 50" aria-hidden="true" style={{ flex: "none", margin: `0 ${h * -0.04}px` }}>
      <path d="M15.5 1 L2 27 Q1 29 3.5 29 H9.5 L7 47 Q6.8 49.5 9 47.5 L21 22 Q22 20 19.5 20 H13.5 L17.8 3 Q18.4 0.5 15.5 1 Z"
        fill={color} stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** Brand logo — the bubbly "MoMoMe" wordmark (yellow/orange letters + a green
 *  lightning bolt). `src` overrides with an uploaded logo; `withWord={false}`
 *  renders the compact square app-icon; `size` is the wordmark/icon height. */
export function Logo({ size = 26, withWord = true, mono = false, src = null }: { size?: number; withWord?: boolean; mono?: boolean; src?: string | null }) {
  if (src) return <img src={src} alt="MoMoMe" height={size} style={{ height: size, width: "auto", flex: "none", objectFit: "contain", borderRadius: size * 0.22, verticalAlign: "middle" }} />;

  const yellow = mono ? "currentColor" : "var(--brand)";
  const orange = mono ? "currentColor" : "var(--accent)";
  const green = mono ? "currentColor" : "var(--recv)";

  // Compact square app-icon (favicons / tight tiles): bolt on a rounded tile.
  if (!withWord) {
    return (
      <span style={{ display: "inline-grid", placeItems: "center", width: size, height: size, borderRadius: size * 0.28, background: mono ? "transparent" : yellow, flex: "none" }}>
        <Bolt h={size * 0.74} color={mono ? "currentColor" : "var(--brand-ink)"} />
      </span>
    );
  }

  const f = size * 1.42; // Bagel Fat One cap-height ≈ 0.7em → wordmark height ≈ size
  const letter = (text: string, color: string) => <span style={{ color }}>{text}</span>;
  return (
    <span aria-label="MoMoMe" style={{ display: "inline-flex", alignItems: "center", fontFamily: '"Bagel Fat One", system-ui, sans-serif', fontWeight: 400, fontSize: f, lineHeight: 1, letterSpacing: "-0.04em", whiteSpace: "nowrap", userSelect: "none" }}>
      {letter("Mo", yellow)}{letter("Mo", orange)}
      <Bolt h={f * 0.92} color={green} />
      {letter("M", yellow)}{letter("e", orange)}
    </span>
  );
}

/* ---------- Momo — the mascot ----------
   A friendly lightning character: speed, trust, Mobile Money. Used sparingly
   (welcome, success, empty, loading), never inside transactional flows. */
export function Momo({ size = 96, mood = "happy", className }: { size?: number; mood?: "happy" | "wink" | "wow"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className={className} role="img" aria-label="Momo the lightning mascot" style={{ flex: "none" }}>
      {/* feet */}
      <ellipse cx="39" cy="85" rx="7" ry="5" fill="var(--brand-ink)" />
      <ellipse cx="59" cy="85" rx="7" ry="5" fill="var(--brand-ink)" />
      {/* body */}
      <circle cx="48" cy="46" r="34" fill="var(--brand)" stroke="var(--brand-ink)" strokeWidth="4" />
      {/* cheeks */}
      <circle cx="29" cy="53" r="5" fill="var(--accent)" opacity="0.5" />
      <circle cx="67" cy="53" r="5" fill="var(--accent)" opacity="0.5" />
      {/* eyes */}
      {mood === "wink"
        ? <path d="M34 44 q4 3 8 0" fill="none" stroke="var(--brand-ink)" strokeWidth="4" strokeLinecap="round" />
        : <><circle cx="38" cy="44" r="5" fill="var(--brand-ink)" /><circle cx="39.6" cy="42.3" r="1.6" fill="#fff" /></>}
      <circle cx="58" cy="44" r="5" fill="var(--brand-ink)" />
      <circle cx="59.6" cy="42.3" r="1.6" fill="#fff" />
      {/* mouth */}
      {mood === "wow"
        ? <ellipse cx="48" cy="58" rx="5" ry="6" fill="var(--brand-ink)" />
        : <path d="M38 56 q10 9 20 0" fill="none" stroke="var(--brand-ink)" strokeWidth="4" strokeLinecap="round" />}
      {/* lightning spark */}
      <path d="M79 16 l-10 13 h5.5 l-4.5 11 13 -15 h-5.5 z" fill="var(--brand)" stroke="var(--brand-ink)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- real QR ---------- */
export function QR({ value, size = 188 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { dark: "#1a1714", light: "#ffffff" },
      // Long payloads (a `lightning:` BOLT11 invoice) make a dense QR — drop to
      // level L so it stays comfortably scannable on screen; short addresses keep M.
      errorCorrectionLevel: value.length > 120 ? "L" : "M",
    }).catch(() => {});
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, borderRadius: 10, display: "block" }} aria-label="Payment QR code" role="img" />;
}

/* ---------- asset / rail glyphs ---------- */
export function AssetGlyph({ kind, size = 30 }: { kind: "BTC" | "USDT"; size?: number }) {
  const isBtc = kind === "BTC";
  return (
    <span style={{ width: size, height: size, borderRadius: 9, flex: "none", display: "inline-grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: size * 0.5, color: "#fff", background: isBtc ? "var(--lightning)" : "oklch(0.62 0.13 162)" }}>
      {isBtc ? "₿" : "₮"}
    </span>
  );
}

const RAIL_MAP: Record<string, { label: string; color: string; glyph: string }> = {
  IBEX: { label: "IBEX · Lightning", color: "var(--lightning)", glyph: "⚡" },
  LIGHTNING: { label: "IBEX · Lightning", color: "var(--lightning)", glyph: "⚡" },
  USDT: { label: "IBEX · USDT", color: "var(--tron)", glyph: "◆" },
  ONCHAIN: { label: "Bitcoin · on-chain", color: "var(--lightning)", glyph: "₿" },
  PawaPay: { label: "PawaPay", color: "var(--recv)", glyph: "◎" },
  FX: { label: "FX Engine", color: "var(--info)", glyph: "⇄" },
};
export function RailBadge({ rail }: { rail: string }) {
  const m = RAIL_MAP[rail] ?? RAIL_MAP.IBEX;
  return (
    <span className="pill" style={{ background: "var(--surface)" }}>
      <span style={{ color: m.color, fontSize: 13, lineHeight: 1 }}>{m.glyph}</span>
      <span className="mono" style={{ fontSize: 11, letterSpacing: 0, whiteSpace: "nowrap" }}>{m.label}</span>
    </span>
  );
}

/* ---------- mobile-money provider chip ---------- */
const PROVIDER_COLOR: Record<ProviderId, { color: string; ink: string }> = {
  MTN: { color: "oklch(0.83 0.16 92)", ink: "#1a1400" },
  ORANGE: { color: "oklch(0.70 0.18 48)", ink: "#1a0c00" },
  AIRTEL: { color: "oklch(0.55 0.20 22)", ink: "#fff" },
};
export function ProviderChip({ id, size = "md", active, onClick }: { id: ProviderId; size?: "md" | "lg"; active?: boolean; onClick?: () => void }) {
  const p = PROVIDERS[id];
  const pc = PROVIDER_COLOR[id];
  if (!p) return null;
  const big = size === "lg";
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 9, cursor: onClick ? "pointer" : "default",
        padding: big ? "11px 14px" : "7px 11px", borderRadius: 11, font: "inherit",
        background: active ? "var(--surface)" : "var(--surface-2)",
        border: `1.5px solid ${active ? "var(--accent)" : "var(--line)"}`,
        boxShadow: active ? "var(--shadow-sm)" : "none", transition: "all .15s", width: onClick ? "100%" : "auto",
      }}
    >
      <span style={{ width: big ? 30 : 24, height: big ? 30 : 24, borderRadius: 7, flex: "none", background: pc.color, color: pc.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: big ? 12 : 10, fontFamily: "var(--font-mono)" }}>{p.short}</span>
      <span style={{ fontWeight: 600, fontSize: big ? 15 : 13, color: "var(--ink)", whiteSpace: "nowrap" }}>{p.name}</span>
      {onClick && active && <span style={{ marginLeft: "auto", color: "var(--accent)", fontWeight: 800 }}>✓</span>}
    </Tag>
  );
}

/* ---------- flag ---------- */
const FLAG_BANDS: Record<CountryCode, string[]> = {
  CM: ["#007a5e", "#ce1126", "#fcd116"],
  GA: ["#009e60", "#fcd116", "#3a75c4"],
  TD: ["#002664", "#fecb00", "#c60c30"],
  CG: ["#009543", "#fbde4a", "#dc241f"],
  CF: ["#003082", "#ffffff", "#289728"],
};
export function Flag({ country, size = 18 }: { country: CountryCode; size?: number }) {
  const bands = FLAG_BANDS[country] ?? FLAG_BANDS.CM;
  return (
    <span style={{ display: "inline-flex", width: size * 1.4, height: size, borderRadius: 3, overflow: "hidden", flex: "none", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }}>
      {bands.map((b, i) => <span key={i} style={{ flex: 1, background: b }} />)}
    </span>
  );
}

/* ---------- copy field ---------- */
export function CopyField({ value, label, mono = true }: { value: string; label?: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(value);
    } catch {
      /* clipboard blocked */
    }
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  };
  return (
    <button type="button" onClick={copy} title="Copy" aria-label={label ? `Copy ${label}` : "Copy"} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", font: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        {label && <span style={{ display: "block", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", fontWeight: 700, marginBottom: 2 }}>{label}</span>}
        <span className={mono ? "mono" : ""} style={{ fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{value}</span>
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: done ? "var(--recv)" : "var(--accent)", flex: "none" }}>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

/* ---------- spinner ---------- */
export function Spinner({ size = 18, color = "var(--accent)" }: { size?: number; color?: string }) {
  const style: CSSProperties = { width: size, height: size, borderRadius: "50%", border: `2px solid color-mix(in oklab, ${color} 25%, transparent)`, borderTopColor: color, display: "inline-block", animation: "spin .7s linear infinite", flex: "none" };
  return <span style={style} />;
}

/* ---------- count-up number ---------- */
export function Amount({ value, decimals = 0, suffix = "", className = "", dur = 600 }: { value: number; decimals?: number; suffix?: string; className?: string; dur?: number }) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    let raf = 0;
    const tick = (tm: number) => {
      const k = Math.min(1, (tm - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return <span className={className}>{fmt(v, decimals)}{suffix}</span>;
}

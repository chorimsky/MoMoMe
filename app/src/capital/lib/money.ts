/* ============================================================
   Financial formatting — the one place amounts, percentages, basis points,
   ratios and dates are rendered. Every amount names its currency; XAF and the
   FR/CEMAC "50 000" grouping follow the app's existing convention (lib/format).
   ============================================================ */
import { fmt } from "../../lib/format.js";
import type { Ccy } from "@shared/capital.js";

const DECIMALS: Record<Ccy, number> = { XAF: 0, USD: 0, EUR: 0, USDT: 2, USDC: 2, BTC: 6 };
const SYMBOL: Partial<Record<Ccy, string>> = { USD: "$", EUR: "€" };

/** "12 345 XAF", "$250 000", "0.012500 BTC". Null/undefined → "—". */
export function money(amount: number | null | undefined, ccy: Ccy = "XAF", opts: { compact?: boolean; decimals?: number; sign?: boolean } = {}): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const d = opts.decimals ?? DECIMALS[ccy] ?? 0;
  const neg = amount < 0, abs = Math.abs(amount);
  const body = opts.compact ? compact(abs, d) : fmt(abs, d);
  const signed = `${neg ? "−" : opts.sign && amount > 0 ? "+" : ""}`;
  const sym = SYMBOL[ccy];
  return sym ? `${signed}${sym}${body}` : `${signed}${body} ${ccy}`;
}
/** Compact with a unit suffix — never rounds a real balance down to zero. */
export function compact(n: number, d = 0): string {
  const v = Math.abs(n);
  if (v < 10_000) return fmt(n, d);
  if (v < 999_500) return fmt(n / 1000, 1) + "k";
  if (v < 999_500_000) return fmt(n / 1_000_000, 1) + "M";
  return fmt(n / 1_000_000_000, 2) + "B";
}
export function pct(v: number | null | undefined, d = 1): string { return v == null || !Number.isFinite(v) ? "—" : `${fmt(v, d)}%`; }
export function bps(v: number | null | undefined): string { return v == null || !Number.isFinite(v) ? "—" : `${fmt(v, 0)} bps`; }
export function ratio(v: number | null | undefined, d = 2): string { return v == null || !Number.isFinite(v) ? "—" : `${fmt(v, d)}×`; }
export function count(v: number | null | undefined): string { return v == null || !Number.isFinite(v) ? "—" : fmt(v, 0); }
export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function seconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${fmt(s / 3600, 1)} h`;
  return `${fmt(s / 86_400, 1)} d`;
}
/** Sign-aware growth label: "+8.4%", "−3.1%", "—". */
export function growth(v: number | null | undefined): string { return v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), 1)}%`; }
export const titleCase = (s: string): string => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

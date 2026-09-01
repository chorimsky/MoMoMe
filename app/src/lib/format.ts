export function fmt(n: number, d = 0): string {
  // Group thousands with a non-breaking space ("50 000"), the FR/CEMAC convention —
  // unambiguous for Francophone users (a comma reads as a decimal to them) and clear
  // in English too. XAF is zero-decimal so there's no separator clash. The nbsp keeps
  // the number from wrapping mid-value and is stripped by any \D digit-parse on input.
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, " ");
}export const fmtSats = (n: number) => fmt(Math.round(n)) + " sats";

/** Compact XAF for dense tables — accurate at every scale (never rounds a real
 *  balance down to "0.0M"). Full grouped below 100k, "k" up to 1M, "M" above. */
export function compactXaf(n: number): string {
  const v = Math.round(n);
  if (v < 100_000) return fmt(v);
  if (v < 999_500) return fmt(Math.round(v / 1000)) + "k"; // 999_500 rounds to 1.0M, not "1 000k"
  return fmt(Math.round(v / 100_000) / 10, 1) + "M";
}

export function initials(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

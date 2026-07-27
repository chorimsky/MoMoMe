export function fmt(n: number, d = 0): string {
  // Group thousands with a non-breaking space ("50 000"), the FR/CEMAC convention —
  // unambiguous for Francophone users (a comma reads as a decimal to them) and clear
  // in English too. XAF is zero-decimal so there's no separator clash. The nbsp keeps
  // the number from wrapping mid-value and is stripped by any \D digit-parse on input.
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, " ");
}
export const fmtXAF = (n: number) => fmt(Math.round(n)) + " XAF";
export const fmtSats = (n: number) => fmt(Math.round(n)) + " sats";

export function initials(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function fmt(n: number, d = 0): string {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtXAF = (n: number) => fmt(Math.round(n)) + " XAF";
export const fmtSats = (n: number) => fmt(Math.round(n)) + " sats";

export function initials(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

/* ============================================================
   Connection awareness — lets polling back off on slow/metered mobile data,
   the common case for our Cameroon recipients. Best-effort: the Network
   Information API isn't on Safari/iOS, where we just use the normal cadence.
   ============================================================ */
type Conn = { effectiveType?: string; saveData?: boolean };

/** True on a slow cellular link or Data-Saver — poll less often to spare data + battery. */
export function slowConn(): boolean {
  const c = (navigator as Navigator & { connection?: Conn }).connection;
  if (!c) return false;
  return c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? "");
}

/** Poll interval (ms) scaled for the connection: the slow path roughly doubles it. */
export function pollMs(fast: number, slow: number): number {
  return slowConn() ? slow : fast;
}

/* ============================================================
   Server-state hooks. `useResource` owns loading / error / stale / refresh for
   one fetch; `useAction` wraps a mutation with busy + error. Server state stays
   here; UI state (open panels, drafts) stays in the component.
   ============================================================ */
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { ApiError } from "../../api/client.js";

export interface Resource<T> {
  data: T | null; error: string | null; status: number | null; loading: boolean;
  fetchedAt: number | null; refresh: () => void;
  /** 401/403 → the caller renders the no-permission state instead of an error. */
  forbidden: boolean;
}
export function errorMessage(e: unknown): { message: string; status: number | null } {
  if (e instanceof ApiError) return { message: e.status === 0 ? "Can't reach the server. Check your connection and retry." : e.message, status: e.status };
  const s = (e as { status?: number })?.status;
  return { message: e instanceof Error ? e.message : "Something went wrong.", status: typeof s === "number" ? s : null };
}

export function useResource<T>(fetcher: () => Promise<T>, deps: DependencyList, opts: { enabled?: boolean; pollMs?: number } = {}): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const gen = useRef(0);
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const g = ++gen.current;
    setLoading(true); setError(null); setStatus(null);
    fetcher().then((d) => { if (g !== gen.current) return; setData(d); setFetchedAt(Date.now()); setLoading(false); })
      .catch((e) => { if (g !== gen.current) return; const m = errorMessage(e); setError(m.message); setStatus(m.status); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);
  useEffect(() => {
    if (!opts.pollMs || !enabled) return;
    const t = setInterval(() => setTick((x) => x + 1), opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, enabled]);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, status, loading, fetchedAt, refresh, forbidden: status === 401 || status === 403 };
}

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, onDone?: (r: R) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...args: A): Promise<R | null> => {
    setBusy(true); setError(null);
    try { const r = await fn(...args); onDone?.(r); return r; }
    catch (e) { setError(errorMessage(e).message); return null; }
    finally { setBusy(false); }
  }, [fn, onDone]);
  return { run, busy, error, clear: () => setError(null) };
}

/** "4 minutes ago" for data freshness. */
export function ago(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

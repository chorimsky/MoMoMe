/* ============================================================
   Real-user timing — one small beacon per page view.

   The server's own timer (server/src/core/interop/metrics.ts) starts when a request lands
   and stops when the response is written. It is blind to DNS, the TLS handshake, the last
   mile and the browser's own render — which on a Cameroonian mobile network is most of the
   wait. A laptop probe measured ~200 ms RTT and ~0.88 s for a 60-byte /health; neither
   figure is knowable from the server, and neither is a real user's.

   So this reports what only the browser knows, and nothing else:

     • WHAT IS SENT: six navigation timings, LCP, INP, CLS, the connection class the
       Network Information API reports, and `location.pathname`. That is all.
     • WHAT IS NOT: no identifier, no query string (it carries phone numbers and amounts
       on this site), no hash, no user agent, no IP — the server reads the country from its
       CDN's geo header instead, so no address is ever in the body. The server normalises
       the path again on arrival, so a reference code could not survive even if one leaked
       into it.
     • WHEN: once, on the first `visibilitychange` to hidden, or `pagehide`. Not on
       `unload`, which mobile browsers routinely skip, and not on a timer — a beacon that
       fires mid-session competes with the page's own requests on the connection it is
       trying to measure.
     • HOW: `navigator.sendBeacon`, which the browser flushes after the page is gone, so
       nothing here delays navigation or holds the page open.

   Honoured: Do Not Track, and Global Privacy Control. Both mean no beacon at all.

   Every path is wrapped. A metrics beacon that can throw is a bug that takes the page with
   it, and this one runs on the send flow.
   ============================================================ */

import { routeClass } from "./analytics.js";

const ENDPOINT = `${(import.meta.env.VITE_API_BASE ?? "/api").replace(/\/$/, "")}/rum`;

/** Same rule analytics.ts applies: the operator console and ops pages are not measured. */
function measurable(): boolean {
  const p = location.pathname;
  return !(p.startsWith("/admin") || p.startsWith("/ops"));
}

const sameOrigin = (url: string): boolean => {
  try { return new URL(url, location.href).origin === location.origin; } catch { return false; }
};

type Metrics = {
  path: string;
  connection: string;
  dns?: number; tcp?: number; tls?: number; ttfb?: number; download?: number; domReady?: number;
  lcp?: number; inp?: number; cls?: number;
};

let sent = false;
let lcp: number | undefined;
let inp: number | undefined;
let cls = 0;
let sawShift = false;

/** DNT / GPC. Either one set means the person asked not to be measured. */
function optedOut(): boolean {
  try {
    const nav = navigator as Navigator & { doNotTrack?: string; globalPrivacyControl?: boolean; msDoNotTrack?: string };
    if (nav.globalPrivacyControl === true) return true;
    const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack;
    return dnt === "1" || dnt === "yes";
  } catch { return false; }
}

/** The connection class, as the Network Information API names it. Chrome-family only;
 *  everywhere else this is simply absent, which the server records as "unknown" rather
 *  than guessing from a user agent. */
function connectionClass(): string {
  try {
    const c = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    return typeof c?.effectiveType === "string" ? c.effectiveType : "unknown";
  } catch { return "unknown"; }
}

/** Navigation timings, as segments rather than as absolute offsets — a segment is what a
 *  percentile can be read from, and `ttfb` here is the wait AFTER the connection is up,
 *  so it isolates our server's time from the handshakes before it. */
function navigationTimings(): Partial<Metrics> {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return {};
    const seg = (a: number, b: number): number | undefined => {
      const d = b - a;
      return Number.isFinite(d) && d >= 0 ? Math.round(d) : undefined;
    };
    return {
      dns: seg(nav.domainLookupStart, nav.domainLookupEnd),
      tcp: seg(nav.connectStart, nav.connectEnd),
      // secureConnectionStart is 0 on a plain-HTTP navigation; omit rather than report the
      // whole epoch as a handshake.
      tls: nav.secureConnectionStart > 0 ? seg(nav.secureConnectionStart, nav.connectEnd) : undefined,
      ttfb: seg(nav.requestStart, nav.responseStart),
      download: seg(nav.responseStart, nav.responseEnd),
      domReady: seg(nav.startTime, nav.domContentLoadedEventEnd),
    };
  } catch { return {}; }
}

function observe(): void {
  const on = <T extends PerformanceEntry>(type: string, cb: (entries: T[]) => void, extra: PerformanceObserverInit = {}) => {
    try {
      const po = new PerformanceObserver((list) => { try { cb(list.getEntries() as T[]); } catch { /* ignore */ } });
      po.observe({ type, buffered: true, ...extra });
    } catch { /* unsupported entry type — simply no figure for it */ }
  };

  // LCP: the last one reported before the page is hidden is the real one.
  on<PerformanceEntry>("largest-contentful-paint", (es) => { const e = es[es.length - 1]; if (e) lcp = Math.round(e.startTime); });

  // CLS: the sum of layout-shift scores that were not caused by recent input.
  on<PerformanceEntry & { value: number; hadRecentInput: boolean }>("layout-shift", (es) => {
    for (const e of es) if (!e.hadRecentInput) { cls += e.value; sawShift = true; }
  });

  // Interaction latency. Not a full INP (which is a p98 over the session's interactions);
  // this is the WORST interaction seen, which is the honest cheap approximation and errs
  // toward reporting the page as slower than INP would. Named `inp` because that is the
  // bucket it informs; the server treats it as one more millisecond metric.
  on<PerformanceEntry & { duration: number }>("event", (es) => {
    for (const e of es) if (e.duration > (inp ?? 0)) inp = Math.round(e.duration);
  }, { durationThreshold: 40 } as PerformanceObserverInit);
}

function send(): void {
  if (sent) return;
  sent = true;
  try {
    const body: Metrics = {
      // Collapsed in the BROWSER, with analytics.ts's own regexes, so a payment code or
      // reference never leaves the device. The server normalises it again on arrival —
      // belt and braces, because a client's claim about its own path is still a claim.
      path: routeClass(location.pathname), // never search or hash
      connection: connectionClass(),
      ...navigationTimings(),
      ...(lcp != null ? { lcp } : {}),
      ...(inp != null ? { inp } : {}),
      // Report 0 only when a shift observer actually ran: a missing CLS and a genuinely
      // stable page are different facts, and the server distinguishes them.
      ...(sawShift ? { cls: Math.round(cls * 1000) / 1000 } : {}),
    };
    const json = JSON.stringify(body);
    // sendBeacon ONLY when same-origin. It always sends with credentials mode "include",
    // so cross-origin the browser demands `Access-Control-Allow-Credentials: true`, which
    // this API does not send (it has no cookie auth) and the beacon is refused before it
    // leaves. analytics.ts hit exactly this: in production the app is on momome.xyz and
    // the API on Railway, so every page-hide flush was silently dropped. Worse for a
    // naive fallback — sendBeacon returns TRUE here (it queued), so "if it failed, use
    // fetch" never fires. fetch with keepalive survives unload just as well and does not
    // force credentials.
    if ("sendBeacon" in navigator && sameOrigin(ENDPOINT)) {
      try { navigator.sendBeacon(ENDPOINT, new Blob([json], { type: "application/json" })); return; } catch { /* fall through */ }
    }
    void fetch(ENDPOINT, { method: "POST", body: json, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch { /* telemetry never surfaces */ }
}

/** Start collecting, and arrange to report once. Safe to call more than once. */
export function initRum(): void {
  try {
    if (optedOut() || !measurable()) return;
    if (typeof performance === "undefined" || typeof PerformanceObserver === "undefined") return;
    observe();
    // visibilitychange→hidden is the one event mobile browsers reliably deliver; pagehide
    // covers the desktop back/forward cache. `sent` makes the second one a no-op.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") send(); }, { once: false });
    window.addEventListener("pagehide", send, { once: true });
  } catch { /* never break the app for telemetry */ }
}

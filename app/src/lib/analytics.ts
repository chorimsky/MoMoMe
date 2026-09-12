/* ============================================================
   Product analytics — the web app tells the server where it is used and what people do.

   Anonymous by construction. A random visitor id lives in localStorage (never the device
   key, never a phone number), a session id lives for the tab and is renewed after 30 min
   of silence. Events are small (route class, action name, a few short props) and go out in
   batches — on a timer, when the tab hides, and on unload through sendBeacon so the session
   length is not lost. The operator console and ops pages are never tracked, and a browser
   that asks not to be tracked is respected. Failures are swallowed: analytics may never
   get in the way of a payment.
   ============================================================ */
import { API_BASE } from "../api/client.js";
import { platformOf } from "@shared/apps.js";

type Props = Record<string, string | number | boolean>;
interface Ev { type: "view" | "session_start" | "session_end" | "action"; name: string; t: number; props?: Props; dur?: number }

const VID_KEY = "mm_vid", SID_KEY = "mm_sid", SID_AT = "mm_sid_at";
const IDLE_MS = 30 * 60_000;
const rid = () => { try { return crypto.randomUUID().replace(/-/g, "").slice(0, 24); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); } };
const get = (k: string, s: Storage) => { try { return s.getItem(k); } catch { return null; } };
const set = (k: string, v: string, s: Storage) => { try { s.setItem(k, v); } catch { /* private mode */ } };

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  if (navigator.doNotTrack === "1") return false;
  const p = window.location.pathname;
  return !(p.startsWith("/admin") || p.startsWith("/ops"));
}
function vid(): string { let v = get(VID_KEY, localStorage); if (!v) { v = rid(); set(VID_KEY, v, localStorage); } return v; }
let sessionStarted = false;
function sid(): string {
  const at = Number(get(SID_AT, sessionStorage) ?? 0);
  let s = get(SID_KEY, sessionStorage);
  if (!s || Date.now() - at > IDLE_MS) { s = rid(); set(SID_KEY, s, sessionStorage); sessionStarted = false; startAt = Date.now(); }
  set(SID_AT, String(Date.now()), sessionStorage);
  return s;
}
let startAt = Date.now();
const queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const scr = () => { const w = window.innerWidth; return w < 600 ? "phone" : w < 1024 ? "tablet" : "desktop"; };
const refHost = () => { try { const r = document.referrer ? new URL(document.referrer).hostname : ""; return r && r !== location.hostname ? r : undefined; } catch { return undefined; } };
function envelope(events: Ev[]) {
  return { p: "web", vid: vid(), sid: sid(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: (document.documentElement.lang || navigator.language || "").slice(0, 5), ver: `web-${platformOf(navigator.userAgent)}`, scr: scr(), ref: refHost(), events };
}
function flush(beacon = false): void {
  if (!queue.length) return;
  const body = JSON.stringify(envelope(queue.splice(0, queue.length)));
  const url = `${API_BASE}/telemetry`;
  if (beacon && "sendBeacon" in navigator) { try { navigator.sendBeacon(url, new Blob([body], { type: "application/json" })); return; } catch { /* fall through */ } }
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}
function push(e: Ev): void {
  if (!enabled()) return;
  sid();
  if (!sessionStarted) { sessionStarted = true; queue.push({ type: "session_start", name: "session", t: Date.now() }); }
  queue.push(e);
  if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 4000);
}

/** A screen was shown. `path` should be the ROUTE CLASS (/pay/:code), not the URL. */
export function trackView(path: string): void { push({ type: "view", name: path, t: Date.now() }); }
/** Something happened worth counting: a step in the send flow, a share, a scan result. */
export function track(name: string, props?: Props): void { push({ type: "action", name, t: Date.now(), ...(props ? { props } : {}) }); }

/** Route class: ids and codes collapse so one page is one row in the report. */
export function routeClass(pathname: string): string {
  return pathname
    .replace(/^\/pay\/[^/]+/, "/pay/:code").replace(/^\/m\/[^/]+/, "/m/:code").replace(/^\/legal\/[^/]+/, "/legal/:doc")
    .replace(/\/[0-9a-f]{12,}(?=\/|$)/gi, "/:id") || "/";
}

let wired = false;
export function wireAnalytics(): void {
  if (wired || typeof window === "undefined") return; wired = true;
  const end = () => { if (!enabled()) return; sid(); queue.push({ type: "session_end", name: "session", t: Date.now(), dur: Math.round((Date.now() - startAt) / 1000) }); flush(true); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) end(); });
  window.addEventListener("pagehide", end);
}

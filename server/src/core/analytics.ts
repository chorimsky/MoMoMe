/* ============================================================
   Product analytics — where people use MoMo›Me, for how long, what they do.

   First-party and anonymous by construction. The clients send small batches of
   events: a page or screen view, a session (start / end with its length), an action
   (a step in the send flow, a share, a scan). Each carries a random visitor id the
   client made up and keeps (never a phone number or a device key), a per-session id,
   the platform, the app version, the language, the timezone and a screen-size class.
   No IP is stored: the country is read from the timezone, which is what people set
   their phone to, and is accurate enough for "where are our users".

   Kept as a bounded ring (persisted), and aggregated on read for the admin console:
   sessions and visitors per platform and country, session length, most visited pages
   and time on them, the send funnel step by step, actions, hours of the day. Nothing
   here touches the money path.
   ============================================================ */
import { register, touch } from "./persist.js";

export type Platform = "web" | "android" | "ios";
export type EventType = "view" | "session_start" | "session_end" | "action";
export interface TEvent {
  t: number;              // unix ms, server-assigned unless the client's is within skew
  sid: string;            // session id (per app launch / tab)
  vid: string;            // visitor id (random, kept on the device)
  p: Platform;
  type: EventType;
  name: string;           // route class for a view, action name otherwise
  props?: Record<string, string | number | boolean>;
  dur?: number;           // seconds, on session_end
  tz?: string; lang?: string; ver?: string; scr?: string; ref?: string;
}

const CAP = 120_000;
let events: TEvent[] = [];
register("analytics_events", () => events.slice(-CAP), (d: TEvent[]) => { events = Array.isArray(d) ? d.slice(-CAP) : []; });

const PLATFORMS = new Set<string>(["web", "android", "ios"]);
const TYPES = new Set<string>(["view", "session_start", "session_end", "action"]);
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const clean = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Validate and store a client batch. Returns how many were accepted. Server time wins
 *  unless the client's stamp is within 10 minutes of it (a queued offline batch). */
export function ingest(raw: unknown, now = Date.now()): number {
  if (!raw || typeof raw !== "object") return 0;
  const b = raw as { p?: unknown; vid?: unknown; sid?: unknown; tz?: unknown; lang?: unknown; ver?: unknown; scr?: unknown; ref?: unknown; events?: unknown };
  if (typeof b.p !== "string" || !PLATFORMS.has(b.p) || typeof b.vid !== "string" || !ID.test(b.vid) || typeof b.sid !== "string" || !ID.test(b.sid)) return 0;
  if (!Array.isArray(b.events)) return 0;
  const base = { p: b.p as Platform, vid: b.vid, sid: b.sid, tz: clean(b.tz, 40), lang: clean(b.lang, 8), ver: clean(b.ver, 16), scr: clean(b.scr, 12), ref: clean(b.ref, 60) };
  let n = 0;
  for (const e of b.events.slice(0, 100)) {
    if (!e || typeof e !== "object") continue;
    const x = e as { type?: unknown; name?: unknown; t?: unknown; props?: unknown; dur?: unknown };
    if (typeof x.type !== "string" || !TYPES.has(x.type)) continue;
    const name = clean(x.name, 80) ?? (x.type === "view" ? "/" : x.type);
    let t = typeof x.t === "number" && Math.abs(now - x.t) < 600_000 ? x.t : now;
    if (t > now) t = now;
    const props: Record<string, string | number | boolean> = {};
    if (x.props && typeof x.props === "object") {
      for (const [k, v] of Object.entries(x.props as Record<string, unknown>).slice(0, 8)) {
        if (!/^[a-z][a-z0-9_]{0,23}$/i.test(k)) continue;
        if (typeof v === "number" && Number.isFinite(v)) props[k] = v;
        else if (typeof v === "boolean") props[k] = v;
        else if (typeof v === "string") props[k] = v.slice(0, 60);
      }
    }
    const ev: TEvent = { t, type: x.type as EventType, name, ...base, ...(Object.keys(props).length ? { props } : {}), ...(typeof x.dur === "number" && x.dur >= 0 && x.dur < 86_400 ? { dur: Math.round(x.dur) } : {}) };
    events.push(ev); n++;
  }
  if (events.length > CAP) events.splice(0, events.length - CAP);
  if (n) touch("analytics_events");
  return n;
}

/* ---------- where: timezone → country ---------- */
const TZ_COUNTRY: Record<string, string> = {
  "Africa/Douala": "CM", "Africa/Libreville": "GA", "Africa/Ndjamena": "TD", "Africa/Brazzaville": "CG", "Africa/Bangui": "CF",
  "Africa/Lagos": "NG", "Africa/Kinshasa": "CD", "Africa/Malabo": "GQ", "Africa/Abidjan": "CI", "Africa/Dakar": "SN", "Africa/Accra": "GH",
  "Africa/Nairobi": "KE", "Africa/Johannesburg": "ZA", "Africa/Casablanca": "MA", "Africa/Cairo": "EG", "Africa/Algiers": "DZ", "Africa/Tunis": "TN",
  "Europe/Paris": "FR", "Europe/Brussels": "BE", "Europe/Berlin": "DE", "Europe/London": "GB", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Zurich": "CH", "Europe/Amsterdam": "NL",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Toronto": "CA", "America/Montreal": "CA", "America/Vancouver": "CA",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Shanghai": "CN", "Asia/Tokyo": "JP", "Asia/Kolkata": "IN", "Australia/Sydney": "AU",
};
export function countryOfTz(tz?: string): string {
  if (!tz) return "??";
  if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
  if (tz.startsWith("America/")) return "US*";
  if (tz.startsWith("Europe/")) return "EU*";
  if (tz.startsWith("Africa/")) return "AF*";
  if (tz.startsWith("Asia/")) return "AS*";
  return "??";
}

/* ---------- the report ---------- */
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };
const SEND_STEPS = ["details", "method", "review", "pay", "processing", "success"];

export interface AnalyticsReport {
  generatedAt: string; days: number; from: string;
  totals: { sessions: number; visitors: number; returning: number; views: number; actions: number; sessionSec: { avg: number; p50: number; p90: number }; bounce: number };
  platforms: Array<{ platform: Platform; sessions: number; visitors: number; sessionSecP50: number; share: number }>;
  countries: Array<{ country: string; sessions: number; visitors: number; share: number }>;
  pages: Array<{ path: string; views: number; sessions: number; avgSec: number; entries: number; exits: number }>;
  funnel: Array<{ step: string; sessions: number; ofPrevious: number | null }>;
  actions: Array<{ name: string; count: number; sessions: number; top?: Array<{ value: string; count: number }> }>;
  byHour: number[]; byDay: Array<{ day: string; sessions: number; visitors: number }>;
  languages: Array<{ lang: string; sessions: number }>; versions: Array<{ platform: Platform; ver: string; sessions: number }>;
  screens: Array<{ scr: string; sessions: number }>; referrers: Array<{ ref: string; sessions: number }>;
  durations: Array<{ bucket: string; sessions: number }>;
}

export function report(days = 7, now = Date.now()): AnalyticsReport {
  const from = now - days * 86_400_000;
  const evs = events.filter((e) => e.t >= from);
  const firstSeen = new Map<string, number>();
  for (const e of events) { const f = firstSeen.get(e.vid); if (f === undefined || e.t < f) firstSeen.set(e.vid, e.t); }

  type S = { sid: string; vid: string; p: Platform; first: number; last: number; dur?: number; tz?: string; lang?: string; ver?: string; scr?: string; ref?: string; views: TEvent[]; actions: TEvent[] };
  const sessions = new Map<string, S>();
  for (const e of evs) {
    let s = sessions.get(e.sid);
    if (!s) { s = { sid: e.sid, vid: e.vid, p: e.p, first: e.t, last: e.t, tz: e.tz, lang: e.lang, ver: e.ver, scr: e.scr, ref: e.ref, views: [], actions: [] }; sessions.set(e.sid, s); }
    s.first = Math.min(s.first, e.t); s.last = Math.max(s.last, e.t);
    if (e.tz) s.tz = e.tz; if (e.lang) s.lang = e.lang; if (e.ver) s.ver = e.ver; if (e.scr) s.scr = e.scr; if (e.ref && !s.ref) s.ref = e.ref;
    if (e.type === "session_end" && e.dur != null) s.dur = Math.max(s.dur ?? 0, e.dur);
    if (e.type === "view") s.views.push(e);
    if (e.type === "action") s.actions.push(e);
  }
  const all = [...sessions.values()];
  const secOf = (s: S) => Math.max(s.dur ?? 0, Math.round((s.last - s.first) / 1000));
  const secs = all.map(secOf);
  const visitors = new Set(all.map((s) => s.vid));
  const returning = [...visitors].filter((v) => (firstSeen.get(v) ?? now) < from).length;
  const count = <K,>(xs: K[]) => { const m = new Map<K, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
  const uniq = <K,>(pairs: Array<[K, string]>) => { const m = new Map<K, Set<string>>(); for (const [k, v] of pairs) { if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); } return m; };

  // platforms
  const platforms = (["web", "android", "ios"] as Platform[]).map((platform) => { const ss = all.filter((s) => s.p === platform); return { platform, sessions: ss.length, visitors: new Set(ss.map((s) => s.vid)).size, sessionSecP50: pct(ss.map(secOf), 50), share: all.length ? ss.length / all.length : 0 }; });
  // countries
  const cc = count(all.map((s) => countryOfTz(s.tz)));
  const cv = uniq(all.map((s) => [countryOfTz(s.tz), s.vid] as [string, string]));
  const countries = [...cc.entries()].map(([country, n]) => ({ country, sessions: n, visitors: cv.get(country)?.size ?? 0, share: all.length ? n / all.length : 0 })).sort((a, b) => b.sessions - a.sessions).slice(0, 20);
  // pages with time on page = gap to the next view in the session (capped 30 min), entries/exits
  const pageAgg = new Map<string, { views: number; sessions: Set<string>; secs: number[]; entries: number; exits: number }>();
  for (const s of all) {
    const vs = [...s.views].sort((a, b) => a.t - b.t);
    vs.forEach((v, i) => {
      let a = pageAgg.get(v.name);
      if (!a) { a = { views: 0, sessions: new Set(), secs: [], entries: 0, exits: 0 }; pageAgg.set(v.name, a); }
      a.views++; a.sessions.add(s.sid);
      const next = vs[i + 1];
      const end = next ? next.t : s.dur != null ? s.first + s.dur * 1000 : s.last;
      const sec = Math.min(1800, Math.max(0, Math.round((end - v.t) / 1000)));
      if (next || sec > 0) a.secs.push(sec);
      if (i === 0) a.entries++;
      if (i === vs.length - 1) a.exits++;
    });
  }
  const pages = [...pageAgg.entries()].map(([path, a]) => ({ path, views: a.views, sessions: a.sessions.size, avgSec: a.secs.length ? Math.round(a.secs.reduce((x, y) => x + y, 0) / a.secs.length) : 0, entries: a.entries, exits: a.exits })).sort((a, b) => b.views - a.views).slice(0, 40);
  // send funnel: distinct sessions that reached each step
  const reached = SEND_STEPS.map((step) => new Set(all.filter((s) => s.actions.some((a) => a.name === "send_step" && a.props?.step === step)).map((s) => s.sid)).size);
  const funnel = SEND_STEPS.map((step, i) => ({ step, sessions: reached[i], ofPrevious: i === 0 ? null : reached[i - 1] ? reached[i] / reached[i - 1] : null }));
  // actions with their most common first prop value
  const actAgg = new Map<string, { count: number; sessions: Set<string>; values: Map<string, number> }>();
  for (const s of all) for (const a of s.actions) {
    let x = actAgg.get(a.name); if (!x) { x = { count: 0, sessions: new Set(), values: new Map() }; actAgg.set(a.name, x); }
    x.count++; x.sessions.add(s.sid);
    const v = a.props ? Object.entries(a.props).find(([k]) => k !== "step")?.[1] : undefined;
    if (v !== undefined) { const key = String(v); x.values.set(key, (x.values.get(key) ?? 0) + 1); }
  }
  const actions = [...actAgg.entries()].map(([name, x]) => ({ name, count: x.count, sessions: x.sessions.size, ...(x.values.size ? { top: [...x.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count })) } : {}) })).sort((a, b) => b.count - a.count).slice(0, 40);
  // by hour (local hour when the client told us its timezone), by day
  const byHour = new Array(24).fill(0) as number[];
  for (const s of all) { let h: number; try { h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: s.tz || "UTC" }).format(new Date(s.first))); } catch { h = new Date(s.first).getUTCHours(); } byHour[((h % 24) + 24) % 24]++; }
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const dm = new Map<string, { sessions: number; visitors: Set<string> }>();
  for (let i = days - 1; i >= 0; i--) dm.set(dayKey(now - i * 86_400_000), { sessions: 0, visitors: new Set() });
  for (const s of all) { const d = dm.get(dayKey(s.first)); if (d) { d.sessions++; d.visitors.add(s.vid); } }
  const byDay = [...dm.entries()].map(([day, d]) => ({ day, sessions: d.sessions, visitors: d.visitors.size }));
  const top = <K,>(m: Map<K, number>, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const languages = top(count(all.map((s) => s.lang ?? "?"))).map(([lang, sessions]) => ({ lang, sessions }));
  const versions = top(count(all.map((s) => `${s.p}|${s.ver ?? "?"}`))).map(([k, sessions]) => ({ platform: k.split("|")[0] as Platform, ver: k.split("|")[1], sessions }));
  const screens = top(count(all.map((s) => s.scr ?? "?"))).map(([scr, sessions]) => ({ scr, sessions }));
  const referrers = top(count(all.filter((s) => s.ref).map((s) => s.ref!))).map(([ref, sessions]) => ({ ref, sessions }));
  const buckets: Array<[string, (x: number) => boolean]> = [["<10 s", (x) => x < 10], ["10–30 s", (x) => x < 30], ["30 s – 1 min", (x) => x < 60], ["1–3 min", (x) => x < 180], ["3–10 min", (x) => x < 600], ["10+ min", () => true]];
  const durations = buckets.map(([bucket, f], i) => ({ bucket, sessions: secs.filter((x) => f(x) && !buckets.slice(0, i).some(([, g]) => g(x))).length }));

  return {
    generatedAt: new Date(now).toISOString(), days, from: new Date(from).toISOString(),
    totals: { sessions: all.length, visitors: visitors.size, returning, views: evs.filter((e) => e.type === "view").length, actions: evs.filter((e) => e.type === "action").length,
      sessionSec: { avg: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : 0, p50: pct(secs, 50), p90: pct(secs, 90) },
      bounce: all.length ? all.filter((s) => s.views.length <= 1 && s.actions.length === 0).length / all.length : 0 },
    platforms, countries, pages, funnel, actions, byHour, byDay, languages, versions, screens, referrers, durations,
  };
}

export function eventCount(): number { return events.length; }

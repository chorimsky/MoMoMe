/* Product analytics — the app tells the server where it is used and what people do.
   Mirrors app/src/lib/analytics.ts. Anonymous by construction: a random visitor id kept
   in SecureStore (never the device key or a phone number), a session id per foreground
   stint (a new one after 30 min in the background). Screens come from the router path,
   sessions from AppState, actions from the screens. Batches go out on a timer and when
   the app goes to the background; nothing here can get in the way of a payment. */
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { AppState, Dimensions, Platform } from 'react-native';

import { API_BASE } from '@/api/client';

type Props = Record<string, string | number | boolean>;
interface Ev { type: 'view' | 'session_start' | 'session_end' | 'action'; name: string; t: number; props?: Props; dur?: number }

const VID_KEY = 'mm_vid';
const IDLE_MS = 30 * 60_000;
const rid = () => Math.random().toString(36).slice(2, 14) + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let vid: string | null = null;
let sid = rid();
let startAt = Date.now();
let hiddenAt = 0;
let sessionStarted = false;
const queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function ensureVid(): Promise<string> {
  if (vid) return vid;
  try { const v = await SecureStore.getItemAsync(VID_KEY); if (v) { vid = v; return v; } } catch { /* first run */ }
  vid = rid();
  try { await SecureStore.setItemAsync(VID_KEY, vid); } catch { /* keep in memory */ }
  return vid;
}
const scr = () => { const w = Dimensions.get('window').width; return w < 600 ? 'phone' : 'tablet'; };
// Hermes ships Intl: no native module needed for the timezone and language.
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };
const lang = () => { try { return (Intl.DateTimeFormat().resolvedOptions().locale ?? '').slice(0, 5); } catch { return undefined; } };
const ver = () => `${Constants.expoConfig?.version ?? '?'}`;

async function flush(): Promise<void> {
  if (!queue.length) return;
  const events = queue.splice(0, queue.length);
  try {
    const body = JSON.stringify({ p: Platform.OS === 'ios' ? 'ios' : 'android', vid: await ensureVid(), sid, tz: tz(), lang: lang(), ver: ver(), scr: scr(), events });
    await fetch(`${API_BASE}/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  } catch { /* dropped — never retry into a user's data plan */ }
}
function push(e: Ev): void {
  if (!sessionStarted) { sessionStarted = true; startAt = Date.now(); queue.push({ type: 'session_start', name: 'session', t: Date.now() }); }
  queue.push(e);
  if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, 4000);
}
export function trackView(path: string): void { push({ type: 'view', name: path, t: Date.now() }); }
export function track(name: string, props?: Props): void { push({ type: 'action', name, t: Date.now(), ...(props ? { props } : {}) }); }
/** Route class: dynamic segments collapse so one screen is one row. */
export function routeClass(pathname: string): string {
  return pathname.replace(/^\/pay\/[^/]+/, '/pay/:code').replace(/^\/legal\/[^/]+/, '/legal/:doc') || '/';
}

let wired = false;
export function wireAnalytics(): void {
  if (wired) return; wired = true;
  AppState.addEventListener('change', (st) => {
    if (st === 'background' || st === 'inactive') {
      if (hiddenAt) return;
      hiddenAt = Date.now();
      if (sessionStarted) { queue.push({ type: 'session_end', name: 'session', t: Date.now(), dur: Math.round((Date.now() - startAt) / 1000) }); void flush(); }
    } else if (st === 'active') {
      if (hiddenAt && Date.now() - hiddenAt > IDLE_MS) { sid = rid(); sessionStarted = false; }
      hiddenAt = 0;
    }
  });
}

/* ============================================================
   Outbound webhooks — MoMo›Me tells a PARTNER what happened to its payments.

   A PSP, bank or merchant platform that creates intents through the v1 API with its API
   key should not poll. It registers an HTTPS endpoint and a shared secret; every canonical
   status change on a payment it owns is POSTed there as a signed event:

     POST <url>
     X-MoMoMe-Signature: t=<unix-ms>,v1=<hex hmac-sha256(secret, `${t}.${body}`)>
     X-MoMoMe-Event-Id: evt_…        (idempotency key for the receiver)
     { id, type: "payment.status", createdAt, data: { paymentId, ref, status, engineState,
       amount, currency, intentId?, note? } }

   Delivery is at-least-once with backoff (1 s, 10 s, 1 min, 10 min, 1 h; then dead), the
   queue is persisted, and every attempt is recorded so an operator can see a partner
   whose endpoint is down. URLs must be public HTTPS (no private/internal hosts — SSRF).
   Nothing here is on the money path: emit() only enqueues.
   ============================================================ */
import { createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookupCb } from "node:dns";
import { promisify } from "node:util";
import type { Payment } from "../../../../shared/types.js";
import { toCanonicalStatus } from "../../../../shared/interop.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { fetchT } from "../../adapters/http.js";
import { liveMoney } from "../../config.js";

export interface Subscription { id: string; owner: string; url: string; secretHint: string; events: string[]; createdAt: string; disabledAt?: string; failures: number; description?: string }
interface StoredSub extends Subscription { secret: string }
export interface OutboundEvent { id: string; subscriptionId: string; owner: string; type: string; body: string; createdAt: string; attempts: number; nextAt: string; lastStatus?: number; lastError?: string; deliveredAt?: string; dead?: boolean }

const dnsLookup = promisify(dnsLookupCb) as (h: string, o: { all: true; verbatim: boolean }) => Promise<Array<{ address: string }>>;

const subs = new Map<string, StoredSub>();
const queue: OutboundEvent[] = [];
const QUEUE_CAP = 5000;
register("outbound_webhooks", () => ({ subs: [...subs.values()], queue: queue.slice(-QUEUE_CAP) }), (d: { subs?: StoredSub[]; queue?: OutboundEvent[] }) => { for (const s of d?.subs ?? []) subs.set(s.id, s); queue.length = 0; queue.push(...(d?.queue ?? [])); });

const PUBLIC_HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const PRIVATE_HOST = /(^|\.)(localhost|internal|local|home|lan|railway\.internal|test)$|^\d+\.\d+\.\d+\.\d+$/i;

/* SSRF. Refusing literal private IPs in the URL is only half the check: a subscriber can
   point a perfectly ordinary public hostname at 169.254.169.254 (cloud metadata), 10.x or
   127.0.0.1, and nothing in the name gives that away. So the address the name RESOLVES to
   is checked at delivery time, every time — DNS can change between subscribe and send. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) // CGNAT
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224; // benchmark, multicast, reserved
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) /* unique-local */ || /^fe[89ab]/.test(v6) /* link-local */ || /^ff/.test(v6) /* multicast */;
}
/** Every address this hostname resolves to must be public, or we do not send. */
async function resolvesPublicly(hostname: string): Promise<boolean> {
  try {
    const addrs = await dnsLookup(hostname, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch { return false; }
}
export function validCallbackUrl(u: string, allowInsecure = false): string | null {
  let url: URL;
  try { url = new URL(u); } catch { return "not a URL"; }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:" && loopback)) return "must be https";
  // Sandbox deployments may target a loopback receiver (tests, local partners); everything
  // else must be a public DNS name — never a private or platform-internal host.
  if (!(allowInsecure && loopback) && (!PUBLIC_HOST.test(url.hostname) || PRIVATE_HOST.test(url.hostname))) return "host must be a public domain name";
  if (url.username || url.password) return "no credentials in the URL";
  return null;
}

export const publicView = ({ secret: _s, ...s }: StoredSub): Subscription => s;

export function subscribe(owner: string, url: string, events: string[] = ["payment.status"], allowInsecure = false): { ok: true; sub: Subscription; secret: string } | { ok: false; reason: string } {
  const bad = validCallbackUrl(url, allowInsecure);
  if (bad) return { ok: false, reason: bad };
  if ([...subs.values()].filter((s) => s.owner === owner && !s.disabledAt).length >= (owner.startsWith("org:") ? 10 : 5)) return { ok: false, reason: owner.startsWith("org:") ? "at most 10 active endpoints per organization" : "at most 5 active subscriptions per key" };
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const sub: StoredSub = { id: id("sub"), owner, url, secret, secretHint: secret.slice(0, 12) + "…", events, createdAt: new Date().toISOString(), failures: 0 };
  subs.set(sub.id, sub); touch("outbound_webhooks");
  return { ok: true, sub: publicView(sub), secret };
}
/** API v1 (docs/api-v1): a subscription with a `description`, editable url/events, enable/disable. */
export function getSubscription(owner: string, subId: string): Subscription | undefined { const s = subs.get(subId); return s && s.owner === owner ? publicView(s) : undefined; }
export function updateSubscription(owner: string, subId: string, patch: { url?: string; events?: string[]; enabled?: boolean; description?: string }, allowInsecure = false): { ok: true; sub: Subscription } | { ok: false; reason: string } {
  const s = subs.get(subId); if (!s || s.owner !== owner) return { ok: false, reason: "not found" };
  if (patch.url) { const bad = validCallbackUrl(patch.url, allowInsecure); if (bad) return { ok: false, reason: bad }; s.url = patch.url; }
  if (patch.events?.length) s.events = patch.events;
  if (patch.enabled === true) { delete s.disabledAt; s.failures = 0; } else if (patch.enabled === false) s.disabledAt = new Date().toISOString();
  if (patch.description !== undefined) s.description = patch.description.slice(0, 200);
  touch("outbound_webhooks"); return { ok: true, sub: publicView(s) };
}
export function subscriptionSecret(owner: string, subId: string): string | undefined { const s = subs.get(subId); return s && s.owner === owner ? s.secret : undefined; }
/** Enqueue one typed event to every matching subscription of `owner` (v1 shape). */
export function enqueueEvent(owner: string, type: string, data: unknown, opts: { onlySub?: string } = {}): string[] {
  const now = new Date().toISOString();
  const targets = [...subs.values()].filter((s) => s.owner === owner && !s.disabledAt && (!opts.onlySub || s.id === opts.onlySub) && (s.events.includes(type) || s.events.includes("*")));
  const ids: string[] = [];
  for (const s of targets) {
    const evt = { id: id("evt"), object: "event", type, created_at: now, livemode: liveMoney(), data };
    queue.push({ id: evt.id, subscriptionId: s.id, owner, type, body: JSON.stringify(evt), createdAt: now, attempts: 0, nextAt: now });
    ids.push(evt.id);
  }
  if (ids.length) { if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP); touch("outbound_webhooks"); void flush(); }
  return ids;
}
/** Re-deliver a past event (a new attempt on the same event id, so the receiver can dedupe). */
export function replayEvent(owner: string, eventId: string): boolean {
  const ev = queue.find((e) => e.id === eventId && e.owner === owner); if (!ev) return false;
  ev.dead = false; delete ev.deliveredAt; ev.nextAt = new Date().toISOString(); touch("outbound_webhooks"); void flush(); return true;
}
export function eventsOf(owner: string, subId?: string, limit = 50): Array<Omit<OutboundEvent, "body"> & { event: unknown }> {
  return queue.filter((e) => e.owner === owner && (!subId || e.subscriptionId === subId)).slice(-limit).reverse().map(({ body, ...e }) => ({ ...e, event: safeJson(body) }));
}
const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
/** Which outbound events (v1 vocabulary) this payment's owner has already been told, so a
 *  transition is announced exactly once. */
const announced = new Map<string, string>();
export function announcedState(paymentId: string): string | undefined { return announced.get(paymentId); }
export function markAnnounced(paymentId: string, state: string): void { announced.set(paymentId, state); if (announced.size > 20_000) announced.delete(announced.keys().next().value as string); }
let v1Projector: ((p: Payment) => { state: string; type: string; data: unknown } | null) | null = null;
/** API v1 registers how a Payment becomes a public event (core/platform/mapping) — outbound stays free of that vocabulary. */
export function setV1Projector(f: typeof v1Projector): void { v1Projector = f; }

export function listSubscriptions(owner: string): Subscription[] { return [...subs.values()].filter((s) => s.owner === owner).map(publicView); }
export function removeSubscription(owner: string, subId: string): boolean { const s = subs.get(subId); if (!s || s.owner !== owner) return false; subs.delete(subId); touch("outbound_webhooks"); return true; }
export function subscriptionCount(): number { return [...subs.values()].filter((s) => !s.disabledAt).length; }

export function sign(secret: string, body: string, t = Date.now()): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Called from the state machine on every transition: enqueue for the payment's owner. */
export function emitPaymentEvent(p: Payment, intentId?: string | null): void {
  if (!p.senderId) return;
  const owner = p.senderId;
  // API v1 typed events (payment.completed, …): once per public state, to subscriptions that asked for that type.
  if (v1Projector) { try { const v = v1Projector(p); if (v && announcedState(p.id) !== v.state) { markAnnounced(p.id, v.state); enqueueEvent(owner, v.type, v.data); } } catch { /* never a settlement failure */ } }
  const targets = [...subs.values()].filter((s) => s.owner === owner && !s.disabledAt && s.events.includes("payment.status"));
  if (!targets.length) return;
  const status = toCanonicalStatus(p.state, p.payInstruction?.expiresAt, Date.now(), [...p.events].reverse().find((e) => e.note)?.note);
  const now = new Date().toISOString();
  for (const s of targets) {
    const evt = { id: id("evt"), type: "payment.status", createdAt: now, data: { paymentId: p.id, ref: p.ref, status, engineState: p.state, amount: p.xaf, currency: "XAF", ...(intentId ? { intentId } : {}), note: p.events[p.events.length - 1]?.note } };
    queue.push({ id: evt.id, subscriptionId: s.id, owner, type: evt.type, body: JSON.stringify(evt), createdAt: now, attempts: 0, nextAt: now });
  }
  if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
  touch("outbound_webhooks");
  void flush();
}

const BACKOFF_MS = [1_000, 10_000, 60_000, 600_000, 3_600_000];
let flushing = false;
/** Deliver everything due. Safe to call often; single-flighted. */
export async function flush(now = Date.now()): Promise<void> {
  if (flushing) return; flushing = true;
  try {
    for (const ev of queue) {
      if (ev.deliveredAt || ev.dead || Date.parse(ev.nextAt) > now) continue;
      const s = subs.get(ev.subscriptionId);
      if (!s || s.disabledAt) { ev.dead = true; ev.lastError = "subscription gone"; continue; }
      ev.attempts++;
      try {
        // Re-check where this hostname points, on every attempt: a subscriber can move the
        // record to a private address after the URL passed validation at subscribe time.
        const host = (() => { try { return new URL(s.url).hostname; } catch { return ""; } })();
        // A sandbox/test subscription may legitimately target a loopback receiver — that is
        // the same exception validCallbackUrl grants at subscribe time, and it never applies
        // where real money moves.
        const loopbackOk = !liveMoney() && (host === "localhost" || host === "127.0.0.1" || host === "::1");
        if (!host || (!loopbackOk && !(await resolvesPublicly(host)))) {
          ev.dead = true; ev.lastError = "endpoint does not resolve to a public address";
          s.failures++; console.warn(`[outbound] refused ${s.url}: host resolves to a private or unresolvable address`);
          continue;
        }
        // A redirect is never a legitimate webhook response, and following one would walk
        // straight past the host checks above into whatever the redirect names.
        const res = await fetchT(s.url, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", "x-momome-signature": sign(s.secret, ev.body), "x-momome-event-id": ev.id, "user-agent": "MoMoMe-Webhooks/1" }, body: ev.body }, 10_000);
        ev.lastStatus = res.status;
        if (res.ok) { ev.deliveredAt = new Date().toISOString(); s.failures = 0; continue; }
        ev.lastError = `HTTP ${res.status}`;
      } catch (e) { ev.lastError = e instanceof Error ? e.message : "request failed"; }
      s.failures++;
      const wait = BACKOFF_MS[Math.min(ev.attempts - 1, BACKOFF_MS.length - 1)];
      if (ev.attempts > BACKOFF_MS.length) { ev.dead = true; console.warn(`[outbound] event ${ev.id} to ${s.url} dead after ${ev.attempts} attempts: ${ev.lastError}`); }
      else ev.nextAt = new Date(now + wait).toISOString();
      // A partner endpoint failing for every event over a long stretch is disabled, not hammered.
      if (s.failures >= 50) { s.disabledAt = new Date().toISOString(); console.warn(`[outbound] subscription ${s.id} (${s.url}) disabled after 50 consecutive failures`); }
    }
    touch("outbound_webhooks");
  } finally { flushing = false; }
}

export function outboundStats(owner?: string): { queued: number; delivered: number; dead: number; recent: Array<Omit<OutboundEvent, "body"> & { preview: string }> } {
  const mine = owner ? queue.filter((e) => e.owner === owner) : queue;
  return {
    queued: mine.filter((e) => !e.deliveredAt && !e.dead).length,
    delivered: mine.filter((e) => e.deliveredAt).length,
    dead: mine.filter((e) => e.dead).length,
    recent: mine.slice(-50).reverse().map(({ body, ...e }) => ({ ...e, preview: body.slice(0, 160) })),
  };
}

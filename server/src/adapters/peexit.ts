/* ============================================================
   Peexit (Peex) payout adapter — the SECOND Mobile Money aggregator.
   Real disbursement via the Peex Platform API (prod: server.peexit.com,
   IP-allowlisted to our egress): SECRETKEY-header auth, POST
   /disbursement/request_payment. The operator (MTN/Orange) is auto-detected from
   the recipient phone — no correspondent code. The request returns a status
   synchronously (new/pending/paid/failed/rejected); the final state then arrives
   two ways: the notification callback (HTTP Basic Auth, an array of txns) AND an
   authoritative re-query GET /disbursement/all_requests?track_id= (the reconcile
   backstop). Same contract as PawaPay so the routing engine can pick either
   invisibly. Idempotent on the payment ref (track_id). Activates when
   PEEXIT_API_KEY is set; otherwise simulated.
   ============================================================ */
import crypto from "node:crypto";
import type { ProviderId, CountryCode } from "../../../shared/types.js";
import { id } from "../core/ids.js";
import { config, peexitLive } from "../config.js";
import { register, touch } from "../core/persist.js";
import type { DisburseRequest, DisburseResult, PayoutStatus } from "./pawapay.js";

const byKey = new Map<string, DisburseResult>();        // payment ref → result
const statusByRef = new Map<string, PayoutStatus>();    // payment ref → last status
register("peexit", () => [...byKey], (d: [string, DisburseResult][]) => { for (const [k, v] of d) byKey.set(k, v); });

/** Local 9-digit MSISDN (Peexit accepts with or without the 237 prefix). */
function localMsisdn(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("237") ? d.slice(3) : d;
}

function splitName(name?: string): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "MoMoMe", last: "Recipient" };
  return { first: parts[0], last: parts.slice(1).join(" ") || parts[0] };
}

function mapStatus(s: string | undefined): PayoutStatus {
  const x = (s ?? "").toLowerCase();
  if (x === "paid") return "COMPLETED";
  if (["failed", "rejected", "cancelled", "canceled"].includes(x)) return "FAILED";
  return "PENDING"; // new / pending / processing
}

async function peex(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${config.peexit.apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", SECRETKEY: config.peexit.apiKey, ...(init.headers ?? {}) },
  });
}

export async function disburse(req: DisburseRequest): Promise<DisburseResult> {
  const existing = byKey.get(req.idempotencyKey);
  if (existing) return { ...existing, status: "duplicate" };
  const real = peexitLive();
  let providerRef: string;
  if (real) {
    providerRef = await liveSubmit(req);
  } else {
    providerRef = id("px");
    statusByRef.set(req.idempotencyKey, "COMPLETED"); // simulated → completes
  }
  const result: DisburseResult = { status: "accepted", providerRef, simulated: !real };
  byKey.set(req.idempotencyKey, result);
  touch("peexit");
  return result;
}

async function liveSubmit(req: DisburseRequest): Promise<string> {
  const { first, last } = splitName(req.name);
  const res = await peex("/disbursement/request_payment", {
    method: "POST",
    body: JSON.stringify({
      amount: req.xaf, // sandbox fixes the real amount to 10 XAF
      track_id: req.idempotencyKey,
      mobile_phone: localMsisdn(req.phone),
      currency: "XAF",
      sender_first_name: "MoMoMe", sender_last_name: "Pay", sender_mobile_phone: "677000000",
      first_name: first, last_name: last,
      country: req.country, // ISO Alpha-2 (e.g. CM)
      purpose: "FAMILY", fund_origin: "SALARY",
    }),
  });
  if (!res.ok) throw new Error(`Peexit disbursement failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { request?: { id?: number | string; status?: string } };
  const reqObj = data.request ?? (data as { id?: number | string; status?: string });
  statusByRef.set(req.idempotencyKey, mapStatus(reqObj.status));
  return String(reqObj.id ?? req.idempotencyKey);
}

/* ---------- cash-in (COLLECTION — request payment FROM a number) ----------
   Peex Collect API: POST /collection/request_payment (SAME SECRETKEY as disbursement;
   the docs' /collection/me is a GET for account info, which is why POSTing it 401'd).
   Required body (confirmed from Peexit's own 422 validation): track_id, phone, amount,
   currency, country, customer_name — a DIFFERENT schema from disbursement (phone not
   mobile_phone; a single customer_name not first/last). The payer approves on their
   phone. */
export async function collect(req: DisburseRequest): Promise<{ status: "accepted"; providerRef: string; simulated: boolean }> {
  if (!peexitLive()) return { status: "accepted", providerRef: id("pxc"), simulated: true };
  const res = await peex("/collection/request_payment", {
    method: "POST",
    body: JSON.stringify({
      track_id: req.idempotencyKey,
      phone: localMsisdn(req.phone),   // the payer we collect FROM
      amount: req.xaf,
      currency: "XAF",
      country: req.country,            // ISO Alpha-2 (e.g. CM)
      customer_name: (req.name && req.name.trim()) || "Customer",
    }),
  });
  if (!res.ok) throw new Error(`Peexit collection failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { request?: { id?: number | string; status?: string }; id?: number | string; status?: string };
  const reqObj = data.request ?? (data as { id?: number | string; status?: string });
  return { status: "accepted", providerRef: String(reqObj.id ?? req.idempotencyKey), simulated: false };
}

/** Authoritative COLLECTION status by track_id — GET /collection/all_requests?track_id=.
 *  The row carries `paid_time` (set once the payer approves = COMPLETED) and, on some
 *  responses, a `status`. 404 = outside the 3-day window / not found → null. Used to
 *  settle a "pending" cash-in (a collection is async — the payer approves on their
 *  phone). Returns null when not live. */
export async function collectStatus(trackId: string): Promise<PayoutStatus | null> {
  if (!peexitLive()) return null;
  try {
    const res = await peex(`/collection/all_requests?track_id=${encodeURIComponent(trackId)}`, { method: "GET" });
    if (res.status === 404 || !res.ok) return null;
    const d = (await res.json()) as { paid_time?: string | null; status?: string } | Array<{ paid_time?: string | null; status?: string }>;
    const row = Array.isArray(d) ? d[0] : d;
    if (!row) return null;
    if (row.status) return mapStatus(row.status);
    return row.paid_time ? "COMPLETED" : "PENDING";
  } catch { return null; }
}

export async function queryStatus(idempotencyKey: string): Promise<PayoutStatus | null> {
  const local = byKey.get(idempotencyKey);
  if (!local) return null;
  if (local.simulated) return "COMPLETED";
  const cached = statusByRef.get(idempotencyKey) ?? "PENDING";
  if (!peexitLive()) return cached;
  // AUTHORITATIVE re-query: GET /disbursement/all_requests?track_id= returns our
  // requests from the last 3 days with their current status. This is what lets the
  // reconcile backstop settle a payout even if the callback is lost, and lets the
  // callback handler confirm the status rather than trust the posted body alone.
  try {
    const res = await peex(`/disbursement/all_requests?track_id=${encodeURIComponent(idempotencyKey)}`, { method: "GET" });
    // 404 = "Transactions not found on your listing! (3 days)" → outside the
    // window (too new or >3 days); keep the last known status.
    if (res.status === 404 || !res.ok) return cached;
    const arr = (await res.json()) as Array<{ track_id?: string; status?: string; payment_proof?: string; message?: string }>;
    const row = Array.isArray(arr) ? (arr.find((r) => r.track_id === idempotencyKey) ?? arr[0]) : undefined;
    if (!row?.status) return cached;
    const mapped = mapStatus(row.status);
    statusByRef.set(idempotencyKey, mapped);
    // Capture the rejection reason (e.g. INSUFFICIENT_FUND_TO_PAY_TX) so callers can
    // explain WHY a payout failed instead of a bare "failed".
    if (mapped === "FAILED") failReasonByRef.set(idempotencyKey, row.payment_proof || row.message || "rejected");
    return mapped;
  } catch { return cached; }
}

const failReasonByRef = new Map<string, string>();
/** The last rejection reason for a payout ref (from queryStatus), if any. */
export function failReason(idempotencyKey: string): string | undefined {
  return failReasonByRef.get(idempotencyKey);
}

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  return byKey.get(idempotencyKey) ?? null;
}

/** ACCURATE merchant balances from the ACCOUNT endpoints:
 *  - GET /disbursement/me → `disbursement_solde` = the PAYOUT balance (shared across
 *    operators; a payout debits this).
 *  - GET /collection/me   → `collect_solde` = collected funds.
 *  NOTE: `/operators` lists Peexit's OWN internal operator wallets (huge ±billions,
 *  e.g. "MTN LLP Coorp"), NOT our balance — reading those wrongly made an empty payout
 *  balance look funded. Cached briefly. null when not live/reachable. */
let acctCache: { at: number; disbursement: number | null; collect: number | null } | null = null;
async function accountBalances(): Promise<{ disbursement: number | null; collect: number | null }> {
  if (acctCache && Date.now() - acctCache.at < 15_000) return acctCache;
  const read = async (path: string, field: string): Promise<number | null> => {
    try {
      const r = await peex(path, { method: "GET" });
      if (!r.ok) return null;
      const v = (await r.json() as Record<string, unknown>)[field];
      return typeof v === "number" ? v : null;
    } catch { return null; }
  };
  const [disbursement, collect] = await Promise.all([read("/disbursement/me", "disbursement_solde"), read("/collection/me", "collect_solde")]);
  acctCache = { at: Date.now(), disbursement, collect };
  return acctCache;
}

/** Available PAYOUT balance (XAF) — the account's `disbursement_solde` (shared across
 *  operators). null when not live/reachable. */
export async function availableBalanceXaf(_country: CountryCode, _provider?: ProviderId): Promise<number | null> {
  if (!peexitLive()) return null;
  return (await accountBalances()).disbursement;
}

/** Collected balance (XAF) — the account's `collect_solde` (what cash-in fills). */
export async function collectBalanceXaf(): Promise<number | null> {
  if (!peexitLive()) return null;
  return (await accountBalances()).collect;
}

/* ---------- notification callback (async final status) ---------- */
/** Constant-time string compare that doesn't leak length via early return. */
function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}

/** Peexit authenticates its callback with HTTP Basic Auth, using credentials we
 *  define and hand to Peexit (per the /notifications docs — NOT an HMAC). We
 *  validate the inbound `Authorization: Basic …` header against our configured
 *  user/pass. No password configured → accept only OUTSIDE production (sandbox);
 *  in production fail closed so an unauthenticated body can't settle a payout. */
export function verifyCallbackAuth(authHeader: string | undefined): boolean {
  const { callbackUser, callbackPass } = config.peexit;
  if (!callbackPass) return !peexitLive();
  if (typeof authHeader !== "string" || !authHeader.toLowerCase().startsWith("basic ")) return false;
  let decoded: string;
  try { decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8"); } catch { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  return safeEq(decoded.slice(0, i), callbackUser) && safeEq(decoded.slice(i + 1), callbackPass);
}

/** The callback body is an ARRAY of transaction objects (Peexit posts all
 *  non-transmitted transactions), each carrying track_id + status. Returns one
 *  {ref,status} per recognizable entry. */
export function parsePayoutEvents(body: unknown): { ref: string; status: PayoutStatus }[] {
  const list = Array.isArray(body) ? body : [body];
  const out: { ref: string; status: PayoutStatus }[] = [];
  for (const item of list) {
    const e = item as { track_id?: string; status?: string };
    if (e?.track_id && e.status) out.push({ ref: e.track_id, status: mapStatus(e.status) });
  }
  return out;
}

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

async function peex(path: string, init: RequestInit, key: string = config.peexit.apiKey): Promise<Response> {
  return fetch(`${config.peexit.apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", SECRETKEY: key, ...(init.headers ?? {}) },
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
   Peex Collect API: POST /collection/me (SECRETKEY). The account holder approves
   the debit on their phone. Same-currency domestic collection → fxrate 1, XAF→XAF.
   Used by the admin cash-in ops for Orange (MTN→PawaPay). Some fields
   (aml_cft flag, sender/recipient split) are best-effort per the docs; the surfaced
   error will name anything Peexit rejects. */
export async function collect(req: DisburseRequest): Promise<{ status: "accepted"; providerRef: string; simulated: boolean }> {
  if (!peexitLive()) return { status: "accepted", providerRef: id("pxc"), simulated: true };
  const { first, last } = splitName(req.name);
  const res = await peex("/collection/me", {
    method: "POST",
    body: JSON.stringify({
      track_id: req.idempotencyKey,
      mobile_phone: localMsisdn(req.phone),
      amount: req.xaf,
      from_currency: "XAF", to_currency: "XAF", fxrate: 1,
      aml_cft: 0,
      sender_first_name: "MoMoMe", sender_last_name: "Pay", sender_mobile_phone: "677000000", sender_country: "CM",
      first_name: first, last_name: last,
      to_country: req.country, // ISO Alpha-2 (e.g. CM)
      purpose: "FAMILY", fund_origin: "SALES_AND_BUSINESS_DEVELOPMENT",
    }),
  }, config.peexit.collectKey); // Collect API uses its own SECRETKEY (falls back to the disbursement key)
  if (!res.ok) throw new Error(`Peexit collection failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { status?: number; error?: string; message?: string; data?: { id?: number | string; status?: string } };
  if (typeof data.status === "number" && data.status >= 400) throw new Error(`Peexit collection rejected: ${data.status} ${data.error ?? data.message ?? ""}`);
  return { status: "accepted", providerRef: String(data.data?.id ?? req.idempotencyKey), simulated: false };
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
    const arr = (await res.json()) as Array<{ track_id?: string; status?: string }>;
    const row = Array.isArray(arr) ? (arr.find((r) => r.track_id === idempotencyKey) ?? arr[0]) : undefined;
    if (!row?.status) return cached;
    const mapped = mapStatus(row.status);
    statusByRef.set(idempotencyKey, mapped);
    return mapped;
  } catch { return cached; }
}

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  return byKey.get(idempotencyKey) ?? null;
}

/** Wallet balance (XAF) for the operator matching the provider — from
 *  GET /operators `solde`. null when not configured. */
type PeexitOp = { name?: string; solde?: number; disbursement_solde?: number | null };
let balCache: { at: number; ops: PeexitOp[] } | null = null;
// The disbursement-specific wallet when Peexit exposes it (confirmed present on the
// live /operators response, may be null), else the general `solde`.
const opBalance = (o: PeexitOp) => (o.disbursement_solde != null ? Number(o.disbursement_solde) : Number(o.solde ?? 0));
export async function availableBalanceXaf(_country: CountryCode, provider?: ProviderId): Promise<number | null> {
  if (!peexitLive()) return null;
  try {
    if (!balCache || Date.now() - balCache.at > 15_000) {
      const res = await peex("/operators", { method: "GET" });
      if (!res.ok) return null;
      balCache = { at: Date.now(), ops: (await res.json()) as PeexitOp[] };
    }
    const want = provider === "ORANGE" ? "orange" : provider === "AIRTEL" ? "airtel" : "mtn";
    // Prefer the canonical country operator (e.g. "MTN-CM" / "Orange-cm"); else
    // the best same-network wallet. This reflects the wallet the payout debits,
    // so a negative MTN-CM means MTN won't route here while a funded Orange-cm will.
    const exact = balCache.ops.find((o) => (o.name ?? "").toLowerCase() === `${want}-cm`);
    if (exact) return opBalance(exact);
    const soldes = balCache.ops.filter((o) => (o.name ?? "").toLowerCase().includes(want)).map(opBalance);
    return soldes.length ? Math.max(...soldes) : 0;
  } catch { return null; }
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

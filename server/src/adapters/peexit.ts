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
import { fetchT } from "./http.js";
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

// Known-pending statuses — the payout is accepted but not yet settled.
const PEEXIT_PENDING = new Set(["new", "pending", "processing", "accepted", "in_progress", "inprogress", "queued", "initiated"]);
function mapStatus(s: string | undefined): PayoutStatus {
  const x = (s ?? "").toLowerCase().trim();
  // Only UNAMBIGUOUS money-delivered terms complete a payout — completing releases the
  // held crypto, so we never guess a synonym that might merely mean "request accepted".
  if (["paid", "success", "successful"].includes(x)) return "COMPLETED";
  if (["failed", "rejected", "cancelled", "canceled", "declined", "reversed"].includes(x)) return "FAILED";
  // Anything not in the known-pending set is a status we've never seen — surface it so a
  // real (settled/failed) synonym is caught and added deliberately, rather than silently
  // held as PENDING forever (crypto stranded).
  if (x && !PEEXIT_PENDING.has(x)) console.warn(`[peexit] unrecognized status "${x}" → treating as PENDING (verify mapping)`);
  return "PENDING";
}

/** Every Peexit call goes through here, so the egress proxy applies uniformly to
 *  disbursement, collection, status re-query and balance reads — a partial rollout would
 *  leave some calls arriving from a non-allowlisted IP and 403ing. */
async function peex(path: string, init: RequestInit): Promise<Response> {
  return fetchT(
    `${config.peexit.apiUrl}${path}`,
    { ...init, headers: { "content-type": "application/json", SECRETKEY: config.peexit.apiKey, ...(init.headers ?? {}) } },
    12_000,
    config.peexit.proxyUrl || undefined,
  );
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
  const mapped = mapStatus(reqObj.status);
  // Positive-acceptance check (PawaPay asserts the same on its accept states): a genuine
  // accept carries an id and/or a non-failure status. A 2xx that maps to FAILED, or one
  // with NEITHER an id nor a status (soft error / unexpected shape), is NOT an accepted
  // payout — throw so submitWithRetry → beginRefund handles it, instead of the payment
  // stranding in PAYOUT_REQUESTED (crypto held, never delivered, never refunded).
  if (mapped === "FAILED" || (reqObj.id == null && !reqObj.status)) {
    throw new Error(`Peexit disbursement not accepted: ${JSON.stringify(data).slice(0, 200)}`);
  }
  statusByRef.set(req.idempotencyKey, mapped);
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
    const d = (await res.json()) as { track_id?: string; paid_time?: string | null; status?: string; fees?: number } | Array<{ track_id?: string; paid_time?: string | null; status?: string; fees?: number }>;
    // Exact track_id match on the array form (same 3-day sibling-row risk as the
    // disbursement path) — a blind d[0] could settle a cash-in against another txn.
    const row = Array.isArray(d) ? d.find((r) => r.track_id === trackId) : d;
    if (!row) return null;
    if (typeof row.fees === "number") feeByRef.set(trackId, row.fees); // Peexit reports the exact fee on the row
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
    const arr = (await res.json()) as Array<{ track_id?: string; status?: string; payment_proof?: string; message?: string; fees?: number }>;
    // Require an EXACT track_id match — the endpoint "returns our requests from the
    // last 3 days", so if Peexit's server-side track_id filter is ignored/loose, a
    // blind arr[0] fallback would settle/fail THIS payout on an unrelated sibling
    // transaction (release crypto for a payout that never landed, or spuriously
    // refund a paid one). No match → keep the last known status, exactly like 404.
    const row = Array.isArray(arr) ? arr.find((r) => r.track_id === idempotencyKey) : undefined;
    if (row && typeof row.fees === "number") feeByRef.set(idempotencyKey, row.fees);
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

const feeByRef = new Map<string, number>();
/** The actual fee (XAF) Peexit charged for an op ref, once its settled row was read
 *  (disbursement or collection). undefined until known. */
export function feeXafFor(idempotencyKey: string): number | undefined {
  return feeByRef.get(idempotencyKey);
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
type Acct = {
  at: number;
  disbursement: number | null; collect: number | null;
  // fee schedule per operator, as the account reports it (orange_fees / mtn_fees)
  disbMtn: number | null; disbOrange: number | null;
  collMtn: number | null; collOrange: number | null;
};
/** Last observed reachability of the Peexit account endpoints. Distinguishes "we could
 *  not reach/authenticate with Peexit" from "the wallet is empty" — those look identical
 *  downstream (both yield a null balance) but need completely different fixes. */
export interface PeexitReachability { ok: boolean; status: number; reason: string; at: string }
let lastReach: PeexitReachability | null = null;
export function reachability(): PeexitReachability | null { return lastReach; }

let acctCache: Acct | null = null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** SINGLE-FLIGHT. The 15s cache does not bound upstream load on a MISS: every
 *  concurrent caller used to run its own pair of account reads, and this is reached
 *  from payoutReady() and selectFundedAggregator() — i.e. once per payment creation
 *  and once per settlement. A burst of N payments therefore became 2N simultaneous
 *  Peexit requests. Peexit sandbox latency was measured climbing 1.3s → 10s under
 *  exactly that pattern, against fetchT's 12s ceiling; crossing it makes balance()
 *  return null, which payoutReady reads as insufficient_rail_balance and refuses
 *  otherwise-good payments. Sharing one in-flight read collapses a burst to a single
 *  round trip. No caller sees a different value — a joiner gets the result of the
 *  read it joined. (Inert while the rail is pre-live, since availableBalanceXaf
 *  returns null before reaching here; this matters the moment Peexit goes production.) */
let acctInflight: Promise<Acct> | null = null;
async function accountBalances(): Promise<Acct> {
  if (acctCache && Date.now() - acctCache.at < 15_000) return acctCache;
  if (acctInflight) return acctInflight; // a read is already running — join it
  const run = accountBalancesUncached();
  acctInflight = run;
  void run.catch(() => {}).then(() => { if (acctInflight === run) acctInflight = null; });
  return run;
}
async function accountBalancesUncached(): Promise<Acct> {
  const read = async (path: string): Promise<Record<string, unknown>> => {
    try {
      const r = await peex(path, { method: "GET" });
      if (!r.ok) {
        lastReach = { ok: false, status: r.status, at: new Date().toISOString(),
          reason: r.status === 403
            ? "403 — egress IP not on Peexit's allowlist (server.peexit.com 403s any non-allowlisted source regardless of SECRETKEY)"
            : r.status === 401 ? "401 — SECRETKEY rejected"
            : `HTTP ${r.status}` };
        // Do NOT swallow this silently. An unreadable balance becomes null →
        // payoutReady reports insufficient_rail_balance, which reads as "the wallet is
        // empty" when the real cause may be that we never reached the account at all.
        // 403 specifically: server.peexit.com is IP-ALLOWLISTED, and it returns an nginx
        // HTML 403 to any non-allowlisted source REGARDLESS of the SECRETKEY — so this is
        // the signature of calling production from an egress IP Peexit has not whitelisted
        // (e.g. after moving hosts), not of a bad key or an unfunded wallet.
        console.warn(
          r.status === 403
            ? `[peexit] ${path} → 403 (nginx). server.peexit.com is IP-allowlisted and 403s ANY non-allowlisted egress regardless of SECRETKEY — this egress IP is almost certainly not on Peexit's allowlist. Balance is UNKNOWN, not zero.`
            : `[peexit] ${path} → HTTP ${r.status}; balance is UNKNOWN, not zero.`,
        );
        return {};
      }
      lastReach = { ok: true, status: r.status, at: new Date().toISOString(), reason: "ok" };
      return (await r.json()) as Record<string, unknown>;
    } catch (e) {
      lastReach = { ok: false, status: 0, at: new Date().toISOString(), reason: `unreachable: ${e instanceof Error ? e.message : e}` };
      console.warn(`[peexit] ${path} unreachable (${e instanceof Error ? e.message : e}); balance is UNKNOWN, not zero.`);
      return {};
    }
  };
  // /disbursement/me → { disbursement_solde, mtn_fees, orange_fees, ... }
  // /collection/me   → { collect_solde, mtn_fees, orange_fees, ... }
  const [d, c] = await Promise.all([read("/disbursement/me"), read("/collection/me")]);
  acctCache = {
    at: Date.now(),
    disbursement: num(d.disbursement_solde), collect: num(c.collect_solde),
    disbMtn: num(d.mtn_fees), disbOrange: num(d.orange_fees),
    collMtn: num(c.mtn_fees), collOrange: num(c.orange_fees),
  };
  return acctCache;
}

/** Force a FRESH account read (bypasses the 15s cache) and report what happened. Backs
 *  the admin "verify against the rail" action: after registering an IP with Peexit the
 *  operator needs to see 403 → 200 immediately, not up to 15s later. */
export async function probeReachability(): Promise<PeexitReachability | null> {
  if (!peexitLive()) return null;
  acctCache = null;
  await accountBalances();
  return lastReach;
}

/** The account's fee schedule (as Peexit reports it on /disbursement/me + /collection/me).
 *  Values are the raw `mtn_fees` / `orange_fees` numbers; null when absent/not live.
 *  Whether these are % or flat XAF is marked by the caller after inspection. */
export async function feeSchedule(): Promise<{ disbMtn: number | null; disbOrange: number | null; collMtn: number | null; collOrange: number | null } | null> {
  if (!peexitLive()) return null;
  const a = await accountBalances();
  return { disbMtn: a.disbMtn, disbOrange: a.disbOrange, collMtn: a.collMtn, collOrange: a.collOrange };
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

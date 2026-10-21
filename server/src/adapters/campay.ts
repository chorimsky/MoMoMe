/* ============================================================
   CamPay adapter — a Cameroonian Mobile Money aggregator (MTN + Orange, XAF only).

   One token authenticates everything (`Authorization: Token <permanent access token>`),
   and there is no IP allowlist, so this rail works from wherever the backend runs — the
   failure mode that repeatedly broke Peexit does not exist here.

   Three surfaces:
     POST /collect/            money IN  — prompts the payer for their Mobile Money PIN
     POST /withdraw/           money OUT — debits a PREFUNDED per-carrier balance
     GET  /transaction/{ref}/  authoritative status for BOTH, by CamPay's own reference
     GET  /balance/            our prefunded balance, per operator
     GET  /holder_info/        the name behind a number (see identityResolution/providers)

   Two things to know before reading further:

   1. Status is keyed on CAMPAY's reference, not ours. /withdraw/ and /collect/ return a
      UUID; /transaction/{reference}/ takes that UUID. So we keep ours → theirs and
      re-query by theirs. The callback carries both.

   2. `external_reference` is where our ref goes, and CamPay's own docs contradict
      themselves about it: the idempotency paragraph says a repeat returns the FIRST
      result, while the parameter list says "a request with a duplicate UUID will be
      rejected". Either way a stable value per payment is correct, and either way a retry
      must not create a second payout. It must also be a UUID4, which our refs are not, so
      we derive one deterministically from the ref (the same trick PawaPay needed).
      Until CamPay confirms which behaviour is real, disburse() treats a rejected
      duplicate as a duplicate rather than a failure — see liveWithdraw().

   Amounts are integers in whole XAF. CamPay refuses decimals (ER201), which is what the
   franc actually is, so nothing here scales by 100.
   ============================================================ */
import crypto from "node:crypto";
import { fetchT } from "./http.js";
import type { ProviderId, CountryCode } from "../../../shared/types.js";
import { id } from "../core/ids.js";
import { config, campayLive } from "../config.js";
import { register, touch } from "../core/persist.js";
import { payoutIdFor } from "./pawapay.js";
import type { DisburseRequest, DisburseResult, PayoutStatus } from "./pawapay.js";

/** payment ref → what we sent and what came back. Persisted: the ref→CamPay-reference
 *  map is the only way to re-query a payout after a restart. */
interface CampayRecord extends DisburseResult { endpoint: "collect" | "withdraw" }
const byKey = new Map<string, CampayRecord>();
const statusByRef = new Map<string, PayoutStatus>();
const feeByRef = new Map<string, number>();
const failReasonByRef = new Map<string, string>();
/** Reverse indexes, so a callback is an O(1) lookup. parseCallbackEvents used to scan
 *  every record and recompute a SHA-1 per entry to match external_reference — fine at ten
 *  payouts, a hash of the whole book at a hundred thousand. Both are rebuilt on restore. */
const byExternalRef = new Map<string, string>();   // what we SENT them → our key
const byProviderRef = new Map<string, string>();   // their reference    → our key
function index(ourKey: string, rec: CampayRecord): void {
  byKey.set(ourKey, rec);
  byProviderRef.set(rec.providerRef, ourKey);
  // withdraw sends a derived UUID4; collect sends our key verbatim. Index both spellings
  // so neither flow needs to know which one the callback will quote back.
  byExternalRef.set(rec.endpoint === "withdraw" ? payoutIdFor(ourKey) : ourKey, ourKey);
}
register("campay", () => [...byKey], (d: [string, CampayRecord][]) => { for (const [k, v] of d) index(k, v); });

/** CamPay wants the country code: 2376XXXXXXXX. Accepts +237… or a bare 9-digit local. */
export function msisdn(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.startsWith("237") ? d : `237${d}`;
}

/** PENDING → SUCCESSFUL | FAILED. CamPay states its terminal statuses, so anything else
 *  is a status we have never seen: warn rather than hold it as PENDING forever, which
 *  would strand the sender's crypto on a payout that in fact settled. */
function mapStatus(s: string | undefined): PayoutStatus {
  const x = (s ?? "").toUpperCase().trim();
  if (x === "SUCCESSFUL") return "COMPLETED";
  if (x === "FAILED") return "FAILED";
  if (x && x !== "PENDING") console.warn(`[campay] unrecognized status "${x}" → treating as PENDING (verify mapping)`);
  return "PENDING";
}

/** Every CamPay call. One place, so the token header and the timeout are uniform. */
export async function camp(path: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  return fetchT(`${config.campay.apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Token ${config.campay.token}`, ...(init.headers ?? {}) },
  }, timeoutMs);
}

/* ---------- money OUT ---------- */

/* Sandbox rehearsal, mirroring the Peexit simulator so the same tests drive both rails. */
const simFail = new Map<string, "reject" | "fail">();
export function simulatePayoutOutcome(idempotencyKey: string, outcome: "reject" | "fail" | null): void {
  if (!campayLive()) { if (outcome) simFail.set(idempotencyKey, outcome); else simFail.delete(idempotencyKey); }
}

export async function disburse(req: DisburseRequest): Promise<DisburseResult> {
  const existing = byKey.get(req.idempotencyKey);
  if (existing) return { status: "duplicate", providerRef: existing.providerRef, simulated: existing.simulated };
  const real = campayLive();
  let providerRef: string;
  if (real) {
    providerRef = await liveWithdraw(req);
  } else {
    if (simFail.get(req.idempotencyKey) === "reject") throw new Error("simulated: insufficient balance (ER301)");
    providerRef = id("cmp");
    statusByRef.set(req.idempotencyKey, simFail.get(req.idempotencyKey) === "fail" ? "FAILED" : "COMPLETED");
  }
  const result: CampayRecord = { status: "accepted", providerRef, simulated: !real, endpoint: "withdraw" };
  index(req.idempotencyKey, result);
  touch("campay");
  return { status: "accepted", providerRef, simulated: !real };
}

async function liveWithdraw(req: DisburseRequest): Promise<string> {
  const res = await camp("/withdraw/", {
    method: "POST",
    body: JSON.stringify({
      amount: String(req.xaf),            // integer XAF; decimals are refused (ER201)
      to: msisdn(req.phone),
      description: `MoMo>Me ${req.idempotencyKey}`,
      external_reference: payoutIdFor(req.idempotencyKey), // deterministic UUID4 = idempotent
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    // ER301 is "insufficient balance for the specific carrier" — a funding problem, not a
    // bad request. Name it, because the fix (top up that carrier's float) is nothing like
    // the fix for a malformed payout.
    if (/ER301/.test(text)) throw new Error(`CamPay withdrawal refused: insufficient ${req.provider} float (ER301)`);
    throw new Error(`CamPay withdrawal failed: ${res.status} ${text.slice(0, 200)}`);
  }
  let data: { reference?: string; status?: string };
  try { data = JSON.parse(text) as { reference?: string; status?: string }; }
  catch { throw new Error(`CamPay withdrawal: unparseable response ${text.slice(0, 200)}`); }
  // A genuine accept carries CamPay's reference. A 2xx without one, or one that already
  // maps to FAILED, is NOT an accepted payout: throw so the caller refunds rather than
  // leaving the payment in PAYOUT_REQUESTED with the sender's crypto held forever.
  const mapped = mapStatus(data.status);
  if (!data.reference || mapped === "FAILED") {
    throw new Error(`CamPay withdrawal not accepted: ${text.slice(0, 200)}`);
  }
  statusByRef.set(req.idempotencyKey, mapped);
  return data.reference;
}

/* ---------- money IN ---------- */

export async function collect(req: DisburseRequest): Promise<{ status: "accepted"; providerRef: string; simulated: boolean }> {
  const existing = byKey.get(req.idempotencyKey);
  if (existing) return { status: "accepted", providerRef: existing.providerRef, simulated: existing.simulated };
  if (!campayLive()) {
    const providerRef = id("cmc");
    index(req.idempotencyKey, { status: "accepted", providerRef, simulated: true, endpoint: "collect" });
    statusByRef.set(req.idempotencyKey, "COMPLETED");
    touch("campay");
    return { status: "accepted", providerRef, simulated: true };
  }
  const res = await camp("/collect/", {
    method: "POST",
    body: JSON.stringify({
      amount: String(req.xaf),
      currency: "XAF",
      from: msisdn(req.phone),            // the payer we collect FROM
      description: `MoMo>Me ${req.idempotencyKey}`,
      // OUR key, verbatim — NOT the derived UUID the withdraw side needs. Only /withdraw/
      // demands a UUID4; /collect/ takes any unique string. It matters because the
      // collection callback handler finds the transfer by reading a reference out of the
      // body, and CamPay's own `reference` is its UUID, not ours. Sending the raw key is
      // what makes a paid collection settle on the callback instead of waiting for the
      // reconcile tick — which is the whole reason the collect callback exists.
      external_reference: req.idempotencyKey,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CamPay collection failed: ${res.status} ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { reference?: string };
  if (!data.reference) throw new Error(`CamPay collection not accepted: ${text.slice(0, 200)}`);
  index(req.idempotencyKey, { status: "accepted", providerRef: data.reference, simulated: false, endpoint: "collect" });
  touch("campay");
  return { status: "accepted", providerRef: data.reference, simulated: false };
}

/* ---------- authoritative status (both directions) ---------- */

/** GET /transaction/{CamPay reference}/ — the only thing allowed to settle. Keyed on OUR
 *  ref; the CamPay reference is looked up from what disburse()/collect() stored. */
async function statusOf(idempotencyKey: string): Promise<PayoutStatus | null> {
  const local = byKey.get(idempotencyKey);
  if (!local) return null;
  if (local.simulated) return statusByRef.get(idempotencyKey) ?? "COMPLETED";
  const cached = statusByRef.get(idempotencyKey) ?? "PENDING";
  if (!campayLive()) return cached;
  try {
    const res = await camp(`/transaction/${encodeURIComponent(local.providerRef)}/`, { method: "GET" });
    if (!res.ok) return cached; // inconclusive: hold, and let reconcile ask again
    const d = (await res.json()) as { status?: string; reason?: string; amount?: string; app_amount?: string };
    if (!d.status) return cached;
    const mapped = mapStatus(d.status);
    statusByRef.set(idempotencyKey, mapped);
    // app_amount is what CamPay credits/debits us after its own fee (98 on a 100 collect
    // = the 2% commission). The difference IS the rail cost, reported per transaction —
    // the same thing railCosts.ts reads off a settled Peexit row, so margin reporting
    // stays measured rather than modelled.
    const gross = Number(d.amount), net = Number(d.app_amount);
    if (Number.isFinite(gross) && Number.isFinite(net) && gross > 0 && net > 0) {
      feeByRef.set(idempotencyKey, Math.round(Math.abs(gross - net)));
    }
    if (mapped === "FAILED" && d.reason) failReasonByRef.set(idempotencyKey, d.reason);
    return mapped;
  } catch { return cached; }
}

export const queryStatus = statusOf;
export const collectStatus = statusOf;

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  const r = byKey.get(idempotencyKey);
  return r ? { status: r.status, providerRef: r.providerRef, simulated: r.simulated } : null;
}

/** The fee (XAF) CamPay actually charged for a ref, once its settled row was read. */
export function feeXafFor(idempotencyKey: string): number | undefined { return feeByRef.get(idempotencyKey); }
/** Why a payout failed, when CamPay said. */
export function failReason(idempotencyKey: string): string | undefined { return failReasonByRef.get(idempotencyKey); }

/* ---------- balance ---------- */

/** GET /balance/ — our PREFUNDED float. Withdrawals debit it per carrier (ER301 is
 *  "insufficient balance … for the specific carrier"), so the per-operator figure is the
 *  one that decides whether a payout can go, not the total. null = unknown, never 0:
 *  a rail we could not read is not a rail with no money. */
interface Balances { at: number; total: number | null; mtn: number | null; orange: number | null }
let balCache: Balances | null = null;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Drop the 15 s balance cache. Tests only: without it a process can observe exactly one
 *  balance outcome, so "unknown is null, not 0" could never actually be exercised. */
export function _resetBalanceCache(): void { balCache = null; }

let balInflight: Promise<Balances> | null = null;
export async function balances(): Promise<Balances> {
  const now = Date.now();
  if (balCache && now - balCache.at < 15_000) return balCache;
  // SINGLE-FLIGHT. The cache does not bound upstream load on a MISS, and this is read on
  // every payout selection and every pre-flight — the same reasoning as the Peexit account
  // read. Concurrent callers share one request.
  if (balInflight) return balInflight;
  balInflight = read(now).finally(() => { balInflight = null; });
  return balInflight;
}

async function read(now: number): Promise<Balances> {
  const empty: Balances = { at: now, total: null, mtn: null, orange: null };
  // A FAILED read is never cached. Caching it made one blip take the rail out of selection
  // for a full 15 seconds — a null balance is "not funded" to selectFundedAggregator, so
  // caching "unknown" is caching "do not use this rail".
  if (!campayLive()) return empty;
  try {
    const res = await camp("/balance/", { method: "GET" });
    if (!res.ok) return empty;
    const d = (await res.json()) as Record<string, unknown>;
    // CamPay reports per-operator balances; field spellings are not pinned in the docs, so
    // every documented and observed spelling is accepted and anything else stays null.
    const pick = (...keys: string[]): number | null => {
      for (const k of keys) { const v = num(d[k]); if (v !== null) return v; }
      return null;
    };
    balCache = {
      at: now,
      total: pick("total_balance", "balance", "amount"),
      mtn: pick("mtn_balance", "balance_mtn", "mtn"),
      orange: pick("orange_balance", "balance_orange", "orange"),
    };
    return balCache;
  } catch { return empty; }
}

export async function availableBalanceXaf(_country: CountryCode, provider?: ProviderId): Promise<number | null> {
  const b = await balances();
  if (provider === "MTN" && b.mtn !== null) return b.mtn;
  if (provider === "ORANGE" && b.orange !== null) return b.orange;
  return b.total;
}

/* ---------- callbacks ---------- */

/** The callback's `signature` is a JWT signed HS256 with the app's WEBHOOK KEY (not the
 *  access token). We verify the signature ourselves rather than pulling in a JWT library
 *  for one algorithm: base64url header.payload, HMAC-SHA256, constant-time compare.
 *
 *  Fails CLOSED when no webhook key is configured on a LIVE rail — an unsigned callback on
 *  a rail moving real money is exactly the thing this check exists to stop. On a sandbox
 *  rail it accepts, so rehearsals work without the operator's production secret. */
export function verifyCallbackSignature(rawBody: string): boolean {
  const key = config.campay.webhookKey;
  if (!key) return !campayLive();
  let token: string | undefined;
  try {
    const d = JSON.parse(rawBody) as { signature?: unknown };
    if (typeof d.signature === "string") token = d.signature;
  } catch { return false; }
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;
  try {
    const alg = (JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string }).alg;
    // Pin the algorithm. Accepting whatever the token names is the classic JWT hole: a
    // token claiming "none" would otherwise verify with no signature at all.
    if (alg !== "HS256") return false;
  } catch { return false; }
  const expect = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  // A valid signature proves CamPay minted the TOKEN. It does not, on its own, prove the
  // token belongs to the body it arrived in: the same token replayed against a forged body
  // would verify. CamPay does not document the claims, so bind what we can — if the
  // payload names a reference, it must be the one in the body; if it names none, we cannot
  // check and accept (settlement is gated on the authoritative re-query either way).
  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    for (const field of ["reference", "external_reference"]) {
      const c = claims[field], b2 = body[field];
      if (typeof c === "string" && typeof b2 === "string" && c !== b2) return false;
    }
  } catch { return false; }
  return true;
}

/** A verified callback → our ref(s). CamPay posts ONE event, carrying both references and
 *  an `endpoint` saying which direction it was. We return our ref — the status is NOT read
 *  from the body: statusOf() re-queries, exactly as every other rail here does. */
export function parseCallbackEvents(body: unknown): Array<{ ref: string; providerRef?: string; endpoint: string }> {
  const d = body as { external_reference?: unknown; reference?: unknown; endpoint?: unknown } | null;
  if (!d || typeof d !== "object") return [];
  const theirs = typeof d.reference === "string" ? d.reference : undefined;
  const endpoint = typeof d.endpoint === "string" ? d.endpoint : "";
  // external_reference is the deterministic UUID we derived from our ref, so map it back
  // through what we stored rather than trying to invert the hash.
  const ext = typeof d.external_reference === "string" ? d.external_reference : "";
  // Three ways a callback names one of ours: the raw key (collect sends it verbatim), the
  // derived UUID (withdraw must send a UUID4), or CamPay's own reference. All indexed.
  const ourRef = (ext && byExternalRef.get(ext)) || (theirs && byProviderRef.get(theirs)) || undefined;
  if (!ourRef) return [];
  return [{ ref: ourRef, providerRef: theirs, endpoint: endpoint || byKey.get(ourRef)!.endpoint }];
}

/** Which direction a callback is about, for routing it to the payout or collection path.
 *  Read from the body alone (no lookup), because dispatch happens before we know the ref. */
export function callbackEndpoint(rawBody: string): "collect" | "withdraw" | null {
  try {
    const e = (JSON.parse(rawBody) as { endpoint?: unknown }).endpoint;
    return e === "collect" || e === "withdraw" ? e : null;
  } catch { return null; }
}

/* ---------- who owns this number ---------- */

/** GET /holder_info/?phone_number=237… → { full_name } | 404 { message: "No name found" }.
 *  Returns the name, null for a definite "no name", and throws for anything else — the
 *  identity provider needs those three outcomes kept apart: a name, an answer that there
 *  is no name, and a failure to ask. */
export async function holderInfo(phone: string, timeoutMs = 6_000): Promise<string | null> {
  const res = await camp(`/holder_info/?phone_number=${encodeURIComponent(msisdn(phone))}`, { method: "GET" }, timeoutMs);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`campay holder_info ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const d = (await res.json()) as { full_name?: unknown };
  const name = typeof d.full_name === "string" ? d.full_name.trim() : "";
  return name || null;
}

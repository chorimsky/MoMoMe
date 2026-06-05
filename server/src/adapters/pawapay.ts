/* ============================================================
   PawaPay payout adapter — real Mobile Money disbursement (v2 API).
   POST /v2/payouts with a {recipient:{type:"MMO",accountDetails:{phoneNumber,
   provider}}} body (the deprecated v1 /payouts used a different "payout flow
   configuration" model that rejected v2-onboarded accounts). Activates the REAL
   payout rail when PAWAPAY_API_KEY is set (independent of RAILS_MODE), otherwise
   simulates. The idempotency contract is REAL: the same payment ref maps to one
   deterministic UUID payoutId, so a retry never produces a second payout.

   Settlement is async: PawaPay accepts the payout, then the final status arrives
   via the /webhooks/pawapay callback — which we treat only as a trigger and
   confirm by re-querying GET /v2/payouts/{payoutId} (authoritative).
   ============================================================ */
import crypto from "node:crypto";
import type { ProviderId, CountryCode } from "../../../shared/types.js";
import { COUNTRIES } from "../../../shared/domain.js";
import { id } from "../core/ids.js";
import { config, pawapayConfigured, isLive } from "../config.js";
import { register, touch } from "../core/persist.js";

export interface DisburseRequest {
  idempotencyKey: string; // the payment ref
  provider: ProviderId;
  country: CountryCode;
  phone: string;
  xaf: number;
  name?: string; // recipient name (some aggregators, e.g. Peexit, require it)
}

export interface DisburseResult {
  status: "accepted" | "duplicate";
  providerRef: string; // the PawaPay payoutId (UUID)
  simulated: boolean;  // true → caller simulates the callback inline
}

export type PayoutStatus = "COMPLETED" | "FAILED" | "PENDING";

/* ---------- Cameroon/CEMAC correspondent + MSISDN mapping ---------- */
const ISO3: Record<CountryCode, string> = { CM: "CMR", GA: "GAB", TD: "TCD", CG: "COG", CF: "CAF" };

/** PawaPay correspondent code, e.g. MTN_MOMO_CMR / ORANGE_CMR. */
function correspondent(provider: ProviderId, country: CountryCode): string {
  const iso = ISO3[country] ?? "CMR";
  if (provider === "ORANGE") return `ORANGE_${iso}`;
  if (provider === "AIRTEL") return `AIRTEL_OAPI_${iso}`;
  return `MTN_MOMO_${iso}`;
}

/** International MSISDN without '+' (e.g. 237670123456). */
function msisdn(phone: string, country: CountryCode): string {
  const dial = COUNTRIES[country].dial.replace(/\D/g, "");
  const d = phone.replace(/\D/g, "");
  return d.startsWith(dial) ? d : dial + d;
}

/** Deterministic UUID from the payment ref, formatted as v4 (PawaPay validates
 *  payoutId is a v4 UUID). Derived from a hash, so it's stable per ref →
 *  idempotent (PawaPay dedupes on payoutId); the v4 bits just satisfy format. */
function payoutIdFor(ref: string): string {
  const NS = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const h = crypto.createHash("sha1").update(Buffer.concat([NS, Buffer.from(ref)])).digest();
  const b = h.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const byKey = new Map<string, DisburseResult>();      // payment ref → result
const byPayoutId = new Map<string, string>();         // payoutId → payment ref
register("pawapay", () => [...byKey], (d: [string, DisburseResult][]) => { for (const [k, v] of d) { byKey.set(k, v); byPayoutId.set(v.providerRef, k); } });

/**
 * SUBMIT a payout. Idempotent on the ref (same ref → "duplicate", never a
 * second payout). Real when configured; otherwise simulated (caller fakes the
 * callback). The final status is confirmed asynchronously.
 */
export async function disburse(req: DisburseRequest): Promise<DisburseResult> {
  const existing = byKey.get(req.idempotencyKey);
  if (existing) return { ...existing, status: "duplicate" };
  const real = pawapayConfigured();
  const providerRef = real ? payoutIdFor(req.idempotencyKey) : id("pp");
  if (real) await liveSubmit(req, providerRef);
  const result: DisburseResult = { status: "accepted", providerRef, simulated: !real };
  byKey.set(req.idempotencyKey, result);
  byPayoutId.set(providerRef, req.idempotencyKey);
  touch("pawapay");
  return result;
}

async function liveSubmit(req: DisburseRequest, payoutId: string): Promise<void> {
  // v2 API: POST /v2/payouts. The recipient carries the provider (MTN_MOMO_CMR /
  // ORANGE_CMR …) directly — no separate correspondent/country/customerTimestamp.
  const res = await fetch(`${config.pawapay.apiUrl}/v2/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.pawapay.apiKey}` },
    body: JSON.stringify({
      payoutId,
      recipient: { type: "MMO", accountDetails: { phoneNumber: msisdn(req.phone, req.country), provider: correspondent(req.provider, req.country) } },
      amount: String(req.xaf), // XAF is a zero-decimal currency
      currency: "XAF",
      customerMessage: "MoMoMe payout", // ≤ 22 chars
    }),
  });
  // A REJECTED payout returns 200 OR 4xx, both with a {status, failureReason} body.
  const data = (await res.json().catch(() => ({}))) as { status?: string; failureReason?: { failureCode?: string; failureMessage?: string } };
  const s = (data.status ?? "").toUpperCase();
  // ACCEPTED = queued for processing; DUPLICATE_IGNORED = idempotent retry.
  if (!["ACCEPTED", "DUPLICATE_IGNORED"].includes(s)) {
    const why = data.failureReason ? `${data.failureReason.failureCode}: ${data.failureReason.failureMessage}` : `HTTP ${res.status} ${JSON.stringify(data)}`;
    throw new Error(`PawaPay payout not accepted: ${why}`);
  }
}

function mapStatus(raw: string | undefined): PayoutStatus {
  const s = (raw ?? "").toUpperCase();
  if (s === "COMPLETED") return "COMPLETED";
  if (["FAILED", "REJECTED"].includes(s)) return "FAILED";
  return "PENDING";
}

/** Authoritative status from PawaPay (used by the callback and reconciliation).
 *  v2: GET /v2/payouts/{id} → { status: "FOUND"|"NOT_FOUND", data: { status } }. */
export async function queryStatusByPayoutId(payoutId: string): Promise<PayoutStatus> {
  try {
    const res = await fetch(`${config.pawapay.apiUrl}/v2/payouts/${payoutId}`, {
      headers: { authorization: `Bearer ${config.pawapay.apiKey}` },
    });
    if (!res.ok) return "PENDING";
    const d = (await res.json()) as { status?: string; data?: { status?: string } };
    if ((d.status ?? "").toUpperCase() === "NOT_FOUND") return "PENDING";
    return mapStatus(d.data?.status); // inner payout status: COMPLETED / FAILED / …
  } catch { return "PENDING"; }
}

/** Re-query a payout's status by payment ref — backstop for a lost callback. */
export async function queryStatus(idempotencyKey: string): Promise<PayoutStatus | null> {
  const local = byKey.get(idempotencyKey);
  if (!local) return null;
  if (local.simulated) return "COMPLETED"; // sandbox: accepted ⇒ completed
  return queryStatusByPayoutId(local.providerRef);
}

/** Map a callback's payoutId back to our payment ref. */
export function refForPayoutId(payoutId: string): string | undefined {
  return byPayoutId.get(payoutId);
}

/** Available wallet balance (XAF) for a country — drives balance-aware routing.
 *  null when PawaPay isn't configured (can't settle). Cached briefly. */
let balCache: { at: number; map: Record<string, number> } | null = null;
export async function availableBalanceXaf(country: CountryCode, _provider?: ProviderId): Promise<number | null> {
  if (!pawapayConfigured()) return null;
  const iso = ISO3[country] ?? "CMR";
  if (balCache && Date.now() - balCache.at < 15_000) return balCache.map[iso] ?? 0;
  try {
    const res = await fetch(`${config.pawapay.apiUrl}/v2/wallet-balances`, {
      headers: { authorization: `Bearer ${config.pawapay.apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { balances?: Array<{ country?: string; balance?: string; currency?: string }> };
    const map: Record<string, number> = {};
    for (const b of data.balances ?? []) if (b.currency === "XAF" && b.country) map[b.country] = Number(b.balance ?? 0);
    balCache = { at: Date.now(), map };
    return map[iso] ?? 0;
  } catch { return null; }
}

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  return byKey.get(idempotencyKey) ?? null;
}

/* ---------- recipient name lookup (the trust layer) ----------
   Resolves a Mobile Money number to its registered account holder name.
   Kept on the deterministic sandbox mock (a real PawaPay name lookup is a
   separate concern); the payout rail going real doesn't change this. */
const NAMES = [
  "NANA JEAN PAUL", "MBARGA ALICE", "FOTSO MARIE", "OWONA PIERRE",
  "TCHOUMI PAUL", "ETOA SANDRINE", "NGASSA DANIEL", "ABENA CLAIRE",
  "MANGA SERGE", "DIALLO AMINA", "EYONG GRACE", "BIYA SAMUEL",
];
const nameCache = new Map<string, { name: string } | null>();

export async function lookupName(phone: string): Promise<{ name: string } | null> {
  const digits = phone.replace(/\D/g, "");
  if (nameCache.has(digits)) return nameCache.get(digits)!;
  const result = isLive() ? null : sandboxLookup(digits);
  nameCache.set(digits, result);
  return result;
}

function sandboxLookup(digits: string): { name: string } | null {
  if (digits === "670123456") return { name: "NANA JEAN PAUL" };
  let h = 0;
  for (let i = 0; i < digits.length; i++) h = (h * 31 + digits.charCodeAt(i)) >>> 0;
  if (+digits[digits.length - 1] >= 8) return null; // ~20% have no registered name on file
  return { name: NAMES[h % NAMES.length] };
}

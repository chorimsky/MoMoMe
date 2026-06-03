/* ============================================================
   PawaPay payout adapter — unified Mobile Money disbursement.
   SANDBOX: simulates a disbursement with strict idempotency.
   The idempotency contract is REAL (BACKEND_DESIGN §1, §2): the same
   key never produces a second payout — the single most important rule.
   ============================================================ */
import crypto from "node:crypto";
import type { ProviderId } from "../../../shared/types.js";
import { id } from "../core/ids.js";
import { config, isLive } from "../config.js";
import { register, touch } from "../core/persist.js";

export interface DisburseRequest {
  idempotencyKey: string;
  provider: ProviderId;
  phone: string;
  xaf: number;
}

export interface DisburseResult {
  status: "accepted" | "duplicate";
  providerRef: string;
}

export type PayoutStatus = "COMPLETED" | "FAILED" | "PENDING";

const byKey = new Map<string, DisburseResult>();
register("pawapay", () => [...byKey], (d: [string, DisburseResult][]) => { for (const [k, v] of d) byKey.set(k, v); });

/**
 * SUBMIT a payout. Idempotent on the key (same key → "duplicate", never a second
 * payout). In live mode this is an async PawaPay request that is CONFIRMED later
 * via the /webhooks/pawapay callback; in sandbox the caller simulates the callback.
 */
export async function disburse(req: DisburseRequest): Promise<DisburseResult> {
  const existing = byKey.get(req.idempotencyKey);
  if (existing) return { ...existing, status: "duplicate" };
  const providerRef = isLive() ? await liveSubmit(req) : id("pp");
  const result: DisburseResult = { status: "accepted", providerRef };
  byKey.set(req.idempotencyKey, result);
  touch("pawapay");
  return result;
}

async function liveSubmit(req: DisburseRequest): Promise<string> {
  // ---- CONFIRM against PawaPay docs (POST /payouts) ----
  const res = await fetch(`${config.pawapay.apiUrl}/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.pawapay.apiKey}` },
    body: JSON.stringify({
      payoutId: req.idempotencyKey, // PawaPay dedupes on this
      amount: String(req.xaf),
      currency: "XAF",
      correspondent: req.provider, // e.g. MTN_MOMO_CMR — map in production
      recipient: { type: "MSISDN", address: { value: req.phone.replace(/\D/g, "") } },
    }),
  });
  if (!res.ok) throw new Error(`PawaPay payout submit failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { payoutId?: string };
  return data.payoutId ?? req.idempotencyKey;
}

/** Re-query a payout's status — backstop for a lost callback, and used on ambiguity. */
export async function queryStatus(idempotencyKey: string): Promise<PayoutStatus | null> {
  const local = byKey.get(idempotencyKey);
  if (!local) return null;
  if (!isLive()) return "COMPLETED"; // sandbox: accepted ⇒ completed
  try {
    // ---- CONFIRM against PawaPay docs (GET /payouts/{id}) ----
    const res = await fetch(`${config.pawapay.apiUrl}/payouts/${idempotencyKey}`, {
      headers: { authorization: `Bearer ${config.pawapay.apiKey}` },
    });
    if (!res.ok) return "PENDING";
    const data = (await res.json()) as { status?: string };
    const s = (data.status ?? "").toUpperCase();
    return s === "COMPLETED" ? "COMPLETED" : ["FAILED", "REJECTED"].includes(s) ? "FAILED" : "PENDING";
  } catch {
    return "PENDING";
  }
}

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  return byKey.get(idempotencyKey) ?? null;
}

/* ---------- payout callback (async confirmation) ---------- */
export function verifyWebhook(rawBody: string, signature: string | undefined): boolean {
  if (!signature || !config.pawapay.webhookSecret) return false;
  const expected = crypto.createHmac("sha256", config.pawapay.webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parsePayoutEvent(body: unknown): { ref: string; status: PayoutStatus } | null {
  // ---- CONFIRM webhook shape against PawaPay docs ----
  const e = body as { payoutId?: string; status?: string };
  if (!e.payoutId || !e.status) return null;
  const s = e.status.toUpperCase();
  const status: PayoutStatus = s === "COMPLETED" ? "COMPLETED" : ["FAILED", "REJECTED"].includes(s) ? "FAILED" : "PENDING";
  return { ref: e.payoutId, status };
}

/* ---------- recipient name lookup (the trust layer) ----------
   Resolves a Mobile Money number to its registered account holder name.
   SANDBOX: deterministic mock. LIVE: PawaPay correspondent lookup.
   Results are cached per number to avoid hammering the provider on
   every keystroke. */
const NAMES = [
  "NANA JEAN PAUL", "MBARGA ALICE", "FOTSO MARIE", "OWONA PIERRE",
  "TCHOUMI PAUL", "ETOA SANDRINE", "NGASSA DANIEL", "ABENA CLAIRE",
  "MANGA SERGE", "DIALLO AMINA", "EYONG GRACE", "BIYA SAMUEL",
];
const nameCache = new Map<string, { name: string } | null>();

export async function lookupName(phone: string): Promise<{ name: string } | null> {
  const digits = phone.replace(/\D/g, "");
  if (nameCache.has(digits)) return nameCache.get(digits)!;
  const result = isLive() ? await liveLookup(digits) : sandboxLookup(digits);
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

async function liveLookup(digits: string): Promise<{ name: string } | null> {
  // ---- CONFIRM against PawaPay docs (correspondent / recipient name lookup) ----
  try {
    const res = await fetch(`${config.pawapay.apiUrl}/v1/lookup?msisdn=${digits}`, {
      headers: { authorization: `Bearer ${config.pawapay.apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    return data.name ? { name: data.name } : null;
  } catch {
    return null; // lookup failures degrade gracefully to manual confirmation
  }
}

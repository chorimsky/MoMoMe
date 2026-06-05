/* ============================================================
   Peexit (Peex) payout adapter — the SECOND Mobile Money aggregator.
   Real disbursement via the Peex Platform API (peexit.com): SECRETKEY-header
   auth, POST /disbursement/request_payment. The operator (MTN/Orange) is
   auto-detected from the recipient phone — no correspondent code. The request
   returns a status synchronously (new/pending/paid/failed/rejected); we map it
   and let the state machine's poll/callback settle. Same contract as PawaPay so
   the routing engine can pick either invisibly. Idempotent on the payment ref
   (track_id). Activates when PEEXIT_API_KEY is set; otherwise simulated.
   ============================================================ */
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

export async function queryStatus(idempotencyKey: string): Promise<PayoutStatus | null> {
  const local = byKey.get(idempotencyKey);
  if (!local) return null;
  if (local.simulated) return "COMPLETED";
  // Peexit returns the status synchronously on submit; the async final state for
  // a "pending" payout arrives via the notification webhook.
  return statusByRef.get(idempotencyKey) ?? "PENDING";
}

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  return byKey.get(idempotencyKey) ?? null;
}

/** Wallet balance (XAF) for the operator matching the provider — from
 *  GET /operators `solde`. null when not configured. */
let balCache: { at: number; ops: Array<{ name?: string; solde?: number }> } | null = null;
export async function availableBalanceXaf(_country: CountryCode, provider?: ProviderId): Promise<number | null> {
  if (!peexitLive()) return null;
  try {
    if (!balCache || Date.now() - balCache.at > 15_000) {
      const res = await peex("/operators", { method: "GET" });
      if (!res.ok) return null;
      balCache = { at: Date.now(), ops: (await res.json()) as Array<{ name?: string; solde?: number }> };
    }
    const want = provider === "ORANGE" ? "orange" : provider === "AIRTEL" ? "airtel" : "mtn";
    // Prefer the canonical country operator (e.g. "MTN-CM" / "Orange-cm"); else
    // the best same-network wallet. This reflects the wallet the payout debits,
    // so a negative MTN-CM means MTN won't route here while a funded Orange-cm will.
    const exact = balCache.ops.find((o) => (o.name ?? "").toLowerCase() === `${want}-cm`);
    if (exact) return Number(exact.solde ?? 0);
    const soldes = balCache.ops.filter((o) => (o.name ?? "").toLowerCase().includes(want)).map((o) => Number(o.solde ?? 0));
    return soldes.length ? Math.max(...soldes) : 0;
  } catch { return null; }
}

/* ---------- notification webhook (async final status) ---------- */
export function verifyWebhook(_rawBody: string, _signature: string | undefined): boolean {
  // Peexit notifications aren't HMAC-signed in a documented way; we confirm by
  // mapping the body's status. (Pair with a sender-IP allowlist in production.)
  return true;
}

export function parsePayoutEvent(body: unknown): { ref: string; status: PayoutStatus } | null {
  // ---- CONFIRM notification shape against Peexit /notifications docs ----
  const e = body as { track_id?: string; status?: string; request?: { track_id?: string; status?: string } };
  const ref = e.track_id ?? e.request?.track_id;
  const status = e.status ?? e.request?.status;
  if (!ref || !status) return null;
  return { ref, status: mapStatus(status) };
}

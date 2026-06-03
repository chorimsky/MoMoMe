/* ============================================================
   Peexit payout adapter — the SECOND Mobile Money aggregator.
   Same contract as the PawaPay adapter (submit, query, webhook) so the
   routing engine can pick either one invisibly. Idempotent on the key.
   ============================================================ */
import crypto from "node:crypto";
import type { ProviderId, CountryCode } from "../../../shared/types.js";
import { id } from "../core/ids.js";
import { config, peexitConfigured } from "../config.js";
import { register, touch } from "../core/persist.js";
import type { DisburseRequest, DisburseResult, PayoutStatus } from "./pawapay.js";

const byKey = new Map<string, DisburseResult>();
register("peexit", () => [...byKey], (d: [string, DisburseResult][]) => { for (const [k, v] of d) byKey.set(k, v); });

export async function disburse(req: DisburseRequest): Promise<DisburseResult> {
  const existing = byKey.get(req.idempotencyKey);
  if (existing) return { ...existing, status: "duplicate" };
  const real = peexitConfigured();
  const providerRef = real ? await liveSubmit(req) : id("px");
  const result: DisburseResult = { status: "accepted", providerRef, simulated: !real };
  byKey.set(req.idempotencyKey, result);
  touch("peexit");
  return result;
}

async function liveSubmit(req: DisburseRequest): Promise<string> {
  // ---- CONFIRM against Peexit docs (payout submit) ----
  const res = await fetch(`${config.peexit.apiUrl}/v1/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.peexit.apiKey}` },
    body: JSON.stringify({ reference: req.idempotencyKey, amount: req.xaf, currency: "XAF", operator: req.provider, msisdn: req.phone.replace(/\D/g, "") }),
  });
  if (!res.ok) throw new Error(`Peexit payout submit failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id?: string };
  return data.id ?? req.idempotencyKey;
}

export async function queryStatus(idempotencyKey: string): Promise<PayoutStatus | null> {
  const local = byKey.get(idempotencyKey);
  if (!local) return null;
  if (local.simulated) return "COMPLETED";
  try {
    const res = await fetch(`${config.peexit.apiUrl}/v1/payouts/${idempotencyKey}`, { headers: { authorization: `Bearer ${config.peexit.apiKey}` } });
    if (!res.ok) return "PENDING";
    const data = (await res.json()) as { status?: string };
    const s = (data.status ?? "").toUpperCase();
    return s === "COMPLETED" ? "COMPLETED" : ["FAILED", "REJECTED"].includes(s) ? "FAILED" : "PENDING";
  } catch { return "PENDING"; }
}

export function statusByKey(idempotencyKey: string): DisburseResult | null {
  return byKey.get(idempotencyKey) ?? null;
}

/** Available wallet balance (XAF) for balance-aware routing. null when Peexit
 *  isn't configured — so it can't be chosen to settle a real payout. */
export async function availableBalanceXaf(_country: CountryCode): Promise<number | null> {
  if (!peexitConfigured()) return null;
  // ---- CONFIRM Peexit balance endpoint when wired ----
  return null;
}

export function verifyWebhook(rawBody: string, signature: string | undefined): boolean {
  if (!signature || !config.peexit.webhookSecret) return false;
  const expected = crypto.createHmac("sha256", config.peexit.webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parsePayoutEvent(body: unknown): { ref: string; status: PayoutStatus } | null {
  // ---- CONFIRM webhook shape against Peexit docs ----
  const e = body as { reference?: string; status?: string };
  if (!e.reference || !e.status) return null;
  const s = e.status.toUpperCase();
  const status: PayoutStatus = s === "COMPLETED" ? "COMPLETED" : ["FAILED", "REJECTED"].includes(s) ? "FAILED" : "PENDING";
  return { ref: e.reference, status };
}

export type { DisburseRequest, DisburseResult, PayoutStatus };

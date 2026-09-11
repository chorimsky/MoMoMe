/* ============================================================
   phoenixd — OUR OWN Lightning node, as a rail.

   ACINQ's phoenixd is a self-custodial Lightning daemon: the seed lives on our volume,
   liquidity is bought automatically from ACINQ's LSP out of the first payments received,
   and it exposes a small HTTP API. It is here for resilience: what the Lightning spec
   requires must not depend on a provider's roadmap. Concretely, LUD-06 (Lightning
   Address) requires the invoice to carry `h` = sha256(metadata); IBEX's /invoice/add
   cannot set it, so strict wallets (Phoenix, Breez SDK…) refuse to pay our Lightning
   Address. phoenixd's createinvoice takes descriptionHash directly.

   API (phoenixd ≥ 0.4, HTTP basic auth, password only):
     POST /createinvoice        form: amountSat, description | descriptionHash, externalId,
                                expirySeconds → { amountSat, paymentHash, serialized }
     GET  /payments/incoming/:h → { paymentHash, isPaid, receivedSat, externalId, … }
     POST /payinvoice           form: invoice, amountSat? → { paymentId, paymentHash, … }
     GET  /payments/outgoing/:id → { status: "pending"|"succeeded"|"failed", … }
     GET  /getbalance           → { balanceSat, feeCreditSat }
   Webhook (--webhook-url): POST JSON { type: "payment_received", amountSat, paymentHash,
   externalId }, HMAC-SHA256 in X-Phoenix-Signature when --webhook-secret is set.

   Amounts: phoenixd speaks SATOSHIS. Our instructions are BTC; convert at the edge.
   ============================================================ */
import crypto from "node:crypto";
import { fetchT } from "./http.js";
import type { Method, PayInstruction } from "../../../shared/types.js";
import { QUOTE_TTL_SEC, lightningQr } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import { config, phoenixdConfigured, phoenixdTrusted } from "../config.js";
import type { InstructionRequest, RailAdapter, RailEvent, SettlementStatus } from "./types.js";
import type { PayResult } from "./ibex.js";

const SATS = 1e8;
const auth = () => "Basic " + Buffer.from(`:${config.phoenixd.password}`).toString("base64");

async function call(path: string, init: { method?: string; form?: Record<string, string> } = {}): Promise<Response> {
  return fetchT(`${config.phoenixd.url}${path}`, {
    method: init.method ?? (init.form ? "POST" : "GET"),
    headers: { Authorization: auth(), ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  }, 15_000);
}

/** Was this invoice paid? phoenixd has no "expired" verdict of its own; the state machine
 *  already expires by the instruction's expiresAt, so `failed` stays false here. */
export async function incomingStatus(paymentHash: string): Promise<SettlementStatus | null> {
  const res = await call(`/payments/incoming/${paymentHash}`);
  if (res.status === 404) return { settled: false, failed: false };
  if (!res.ok) return null;
  const d = (await res.json()) as { isPaid?: boolean; receivedSat?: number; fees?: number };
  const settled = !!d.isPaid || (typeof d.receivedSat === "number" && d.receivedSat > 0);
  // `fees` (sat) is what the node kept — the liquidity purchase on a first receive, else 0.
  // With no channel yet a SMALL payment is absorbed as "fee credit" (the whole amount goes
  // toward the future channel; receivedSat is 0, fees == amount). Either way the customer's
  // Mobile Money is delivered in full; the ledger books the fee (see confirmInbound).
  const feeSat = typeof d.fees === "number" && d.fees > 0 ? d.fees : 0;
  return { settled, failed: false, ...(settled && feeSat > 0 ? { feeBtc: feeSat / SATS } : {}) };
}

export interface NodeBalance { balanceSat: number; feeCreditSat: number }
export async function nodeBalance(): Promise<NodeBalance | null> {
  const res = await call("/getbalance");
  if (!res.ok) return null;
  const d = (await res.json()) as { balanceSat?: number; feeCreditSat?: number };
  return typeof d.balanceSat === "number" ? { balanceSat: d.balanceSat, feeCreditSat: d.feeCreditSat ?? 0 } : null;
}
export async function nodeBalanceSat(): Promise<number | null> { return (await nodeBalance())?.balanceSat ?? null; }

export const phoenixdAdapter: RailAdapter = {
  name: "phoenixd",
  // After IBEX for ordinary in-app Lightning (IBEX also converts); FIRST for anything that
  // needs a description hash — createInstruction reorders on that capability.
  priority: 1,
  descriptionHash: true,
  configured: () => phoenixdConfigured(),
  trusted: () => phoenixdTrusted(),
  supports: (m: Method) => m === "LIGHTNING",

  async createInstruction(req: InstructionRequest): Promise<PayInstruction> {
    const expirySec = Math.min(QUOTE_TTL_SEC.LIGHTNING, 3600);
    const amountSat = Math.ceil(req.amount * SATS - 1e-6);
    const res = await call("/createinvoice", { form: {
      amountSat: String(amountSat),
      externalId: req.ref,
      expirySeconds: String(expirySec),
      // LUD-06: the hash of the LNURL metadata the payer's wallet was shown — this is the
      // whole reason the rail exists. A plain description otherwise.
      ...(req.descriptionHash ? { descriptionHash: req.descriptionHash } : { description: `MoMoMe ${req.ref}`.slice(0, 60) }),
    } });
    if (!res.ok) throw new Error(`phoenixd createinvoice failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const d = (await res.json()) as { amountSat?: number; paymentHash?: string; serialized?: string };
    if (!d.serialized || !d.paymentHash) throw new Error("phoenixd createinvoice returned no invoice");
    const btc = (d.amountSat ?? amountSat) / SATS;
    return {
      method: "LIGHTNING", code: d.serialized, qr: lightningQr(d.serialized), asset: "BTC",
      amount: btc, amountLabel: formatAmount(btc, "BTC"),
      expiresAt: new Date(Date.now() + expirySec * 1000).toISOString(),
      providerRef: d.paymentHash, provider: "phoenixd",
    };
  },

  verifyWebhook(rawBody, headers): boolean {
    if (!phoenixdConfigured()) return false;
    const secret = config.phoenixd.webhookSecret;
    // Without a secret the webhook is a hint only: a Lightning inbound is settled solely on
    // the authoritative re-query (incomingStatus), never on this body — see routes/webhooks.
    if (!secret) return true;
    const sig = headers["x-phoenix-signature"];
    const given = (Array.isArray(sig) ? sig[0] : sig ?? "").trim().toLowerCase();
    const want = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
  },

  parseEvent(body: unknown): RailEvent | null {
    const b = body as { type?: string; paymentHash?: string; amountSat?: number };
    if (!b?.paymentHash || (b.type && b.type !== "payment_received")) return null;
    return { providerRef: b.paymentHash, kind: "confirmed", amount: typeof b.amountSat === "number" ? b.amountSat / SATS : undefined, eventId: b.paymentHash };
  },

  confirmSettlement: (paymentHash: string) => incomingStatus(paymentHash),

  async payInvoice(bolt11: string, amountMsat?: number): Promise<PayResult> {
    const res = await call("/payinvoice", { form: { invoice: bolt11, ...(amountMsat ? { amountSat: String(Math.round(amountMsat / 1000)) } : {}) } });
    if (!res.ok) throw new Error(`phoenixd payinvoice failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const d = (await res.json()) as { paymentId?: string; paymentHash?: string; paymentPreimage?: string; routingFeeSat?: number };
    if (!d.paymentId) throw new Error("phoenixd payinvoice returned no paymentId");
    return { transactionId: d.paymentId, settled: !!d.paymentPreimage, feesMsat: typeof d.routingFeeSat === "number" ? d.routingFeeSat * 1000 : undefined };
  },
  async outboundStatus(paymentId: string): Promise<SettlementStatus | null> {
    const res = await call(`/payments/outgoing/${paymentId}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { status?: string; isPaid?: boolean };
    const st = (d.status ?? "").toLowerCase();
    return { settled: st === "succeeded" || !!d.isPaid, failed: st === "failed" };
  },
};

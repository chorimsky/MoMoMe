/* ============================================================
   Blink (Galoy) rail adapter — SECOND crypto inbound rail alongside IBEX,
   for Lightning + on-chain BTC. Blink is Lightning-first and widely used in
   emerging markets (formerly the Bitcoin Beach Wallet), which fits a
   crypto→Mobile-Money product.

   API: a single GraphQL endpoint authenticated with an `X-API-KEY` header.
     • Lightning invoice   → mutation lnInvoiceCreate  (amount in SATS)
     • On-chain address    → mutation onChainAddressCreate
     • Settlement re-query  → me.defaultAccount.walletById.transactionsByPaymentHash
     • Callback register    → mutation callbackEndpointAdd (boot)

   Activation is decoupled from RAILS_MODE (like IBEX): the adapter is live
   when BLINK_API_KEY + BLINK_WALLET_ID are set. Staging is signet/testnet,
   so a Blink inbound is "trusted" (may drive a real payout) only in production.

   ⚠️ Verified against Blink's published GraphQL schema, but NOT exercised
   live from this codebase (no credentials here). Fields marked "provisional"
   below should be confirmed against a real deposit before going to production.
   Safety net: real settlement never depends on the webhook body — the shared
   webhook handler re-queries confirmSettlement() (authoritative) before paying,
   so a wrong callback shape/signature cannot settle a real payment.
   ============================================================ */
import crypto from "node:crypto";
import { fetchT } from "./http.js";
import type { Method, PayInstruction } from "../../../shared/types.js";
import { QUOTE_TTL_SEC } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import { config, blinkConfigured, blinkInboundTrusted } from "../config.js";
import type { InstructionRequest, RailAdapter, RailEvent, SettlementStatus } from "./types.js";

const btcToSat = (btc: number) => Math.round(btc * 1e8); // 1 BTC = 1e8 sat (Blink BTC wallet unit)
const satToBtc = (sat: number) => sat / 1e8;

/* ---------- GraphQL transport ---------- */
interface GqlResult<T> { data?: T; errors?: Array<{ message?: string }>; }

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetchT(config.blink.apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": config.blink.apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Blink HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as GqlResult<T>;
  if (body.errors?.length) throw new Error(`Blink GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body.data) throw new Error("Blink GraphQL: empty response");
  return body.data;
}

/** A GraphQL mutation may still fail via a `userErrors`/`errors` payload with an
 *  otherwise-200 response — surface it as a throw so createInstruction fails clean. */
function throwUserErrors(errors: Array<{ message?: string }> | undefined, ctx: string): void {
  if (errors?.length) throw new Error(`Blink ${ctx}: ${errors.map((e) => e.message).filter(Boolean).join("; ")}`);
}

/* ---------- boot: register the callback endpoint ---------- */
const M_CALLBACK_ADD = `mutation CallbackEndpointAdd($input: CallbackEndpointAddInput!) {
  callbackEndpointAdd(input: $input) { id errors { message } }
}`;

/** Register our /webhooks/blink URL as a Blink callback endpoint. Idempotent on
 *  Blink's side per URL — an "already exists" error is treated as success. Returns
 *  false (not throw) on a soft failure so boot never crashes on it. */
export async function registerBlinkCallback(): Promise<boolean> {
  const url = `${config.publicUrl}/webhooks/blink`;
  try {
    const d = await gql<{ callbackEndpointAdd: { id?: string; errors?: Array<{ message?: string }> } }>(
      M_CALLBACK_ADD, { input: { url } },
    );
    const errs = d.callbackEndpointAdd?.errors;
    if (errs?.length && !errs.some((e) => /already|exist|duplicate/i.test(e.message ?? ""))) {
      console.error("Blink callbackEndpointAdd:", errs.map((e) => e.message).join("; "));
      return false;
    }
    return true;
  } catch (e) {
    // "already exists" comes back as a GraphQL error on some deployments — tolerate.
    if (e instanceof Error && /already|exist|duplicate/i.test(e.message)) return true;
    throw e;
  }
}

/* ---------- settlement re-query (authoritative) ---------- */
const Q_TX_BY_HASH = `query TxByHash($walletId: WalletId!, $paymentHash: PaymentHash!) {
  me { defaultAccount { walletById(walletId: $walletId) {
    transactionsByPaymentHash(paymentHash: $paymentHash) { status direction }
  } } }
}`;

/** Was this Lightning invoice actually PAID? Re-queries Blink by payment hash.
 *  settled = a RECEIVE transaction with status SUCCESS; failed = a FAILURE tx and
 *  nothing settled. null when the lookup itself fails (network) — indeterminate, so
 *  the caller falls back to the (secret-gated) webhook and never over-settles. */
export async function transactionStatus(paymentHash: string): Promise<SettlementStatus | null> {
  try {
    const d = await gql<{ me?: { defaultAccount?: { walletById?: { transactionsByPaymentHash?: Array<{ status?: string; direction?: string }> } } } }>(
      Q_TX_BY_HASH, { walletId: config.blink.walletId, paymentHash },
    );
    const txs = d.me?.defaultAccount?.walletById?.transactionsByPaymentHash ?? [];
    const settled = txs.some((t) => (t.direction ?? "").toUpperCase() === "RECEIVE" && (t.status ?? "").toUpperCase() === "SUCCESS");
    const failed = !settled && txs.some((t) => (t.status ?? "").toUpperCase() === "FAILURE");
    return { settled, failed };
  } catch {
    return null;
  }
}

/* ---------- inbound instructions ---------- */
const M_LN_INVOICE = `mutation LnInvoiceCreate($input: LnInvoiceCreateInput!) {
  lnInvoiceCreate(input: $input) {
    invoice { paymentRequest paymentHash satoshis }
    errors { message }
  }
}`;

const M_ONCHAIN_ADDR = `mutation OnChainAddressCreate($input: OnChainAddressCreateInput!) {
  onChainAddressCreate(input: $input) { address errors { message } }
}`;

/* ---------- webhook (callback) auth — Svix ---------- */
// Blink delivers callbacks via Svix (confirmed in dev.blink.sv/api/webhooks). Svix signs
// each message as base64( HMAC-SHA256( key, `${id}.${timestamp}.${body}` ) ), where the
// key is the base64-decoded portion of the `whsec_…` endpoint signing secret, and the
// `(svix|webhook)-signature` header carries space-separated `v1,<sig>` tokens.
const timingEq = (a: string, b: string): boolean => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/** Svix signing key = the base64-decoded body of a `whsec_<base64>` secret. */
function svixKey(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const decoded = Buffer.from(raw, "base64");
  // If it wasn't valid base64 (round-trip mismatch), fall back to the raw bytes.
  return decoded.length && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "") ? decoded : Buffer.from(raw);
}

/** Is the raw callback body authentic?
 *  (1) No secret configured → accept ONLY when no real payout can result from a Blink
 *      inbound (sandbox/testing); fail closed otherwise (mirrors IBEX). (2) With a
 *      secret + Svix headers → verify the Svix signature. (3) With a secret but no Svix
 *      headers → HMAC(body) hex/base64 fallback (generic/testing). Real settlement is
 *      STILL gated by the authoritative confirmSettlement re-query, so this is
 *      defence-in-depth: a wrong signature can never, on its own, settle real money.
 *      Note: we do NOT hard-reject on timestamp age — Svix retries keep the original
 *      timestamp for hours, and dropping a delayed retry would lose a settlement
 *      notification (the reconcile backstop + re-query already prevent replay harm). */
function verifyBlink(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  const secret = config.blink.webhookSecret;
  if (!secret) return !blinkInboundTrusted();
  const header = (k: string) => { const v = headers[k.toLowerCase()]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  const sigHeader = header("svix-signature") || header("webhook-signature") || header("x-blink-signature") || header("blink-signature");
  if (!sigHeader) return false;
  // Each token is `v1,<sig>` (or a bare sig); collect the signature parts.
  const tokens = sigHeader.split(/\s+/).map((t) => (t.includes(",") ? t.slice(t.indexOf(",") + 1) : t)).filter(Boolean);

  const svixId = header("svix-id") || header("webhook-id");
  const svixTs = header("svix-timestamp") || header("webhook-timestamp");
  if (svixId && svixTs) {
    const expected = crypto.createHmac("sha256", svixKey(secret)).update(`${svixId}.${svixTs}.${rawBody}`).digest("base64");
    return tokens.some((t) => timingEq(t, expected));
  }
  // Fallback: plain HMAC over the raw body (hex or base64), raw-secret key.
  const hex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const b64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return tokens.some((t) => timingEq(t, hex) || timingEq(t, b64));
}

export const blinkAdapter: RailAdapter = {
  name: "blink",
  // Added rail: after IBEX (0), before the sandbox catch-all. Adjust if Blink should
  // ever take precedence over IBEX for a method.
  priority: 10,
  configured: () => blinkConfigured(),
  trusted: () => blinkInboundTrusted(),
  // Lightning + on-chain BTC. Blink's USD wallet is fiat "stablesats", NOT ERC-20
  // USDT/USDC, so stablecoin methods stay with IBEX/sandbox.
  supports: (m: Method) => m === "LIGHTNING" || m === "ONCHAIN",

  async createInstruction(req: InstructionRequest): Promise<PayInstruction> {
    const expiresAt = new Date(Date.now() + QUOTE_TTL_SEC[req.method] * 1000).toISOString();

    if (req.method === "LIGHTNING") {
      const d = await gql<{ lnInvoiceCreate: { invoice?: { paymentRequest?: string; paymentHash?: string }; errors?: Array<{ message?: string }> } }>(
        M_LN_INVOICE, {
          input: {
            walletId: config.blink.walletId,
            amount: btcToSat(req.amount), // Blink BTC wallet amount is in SATS
            memo: req.ref.slice(0, 64),
            expiresIn: Math.max(1, Math.round(QUOTE_TTL_SEC.LIGHTNING / 60)), // minutes
          },
        },
      );
      throwUserErrors(d.lnInvoiceCreate?.errors, "lnInvoiceCreate");
      const inv = d.lnInvoiceCreate?.invoice;
      if (!inv?.paymentRequest || !inv.paymentHash) throw new Error("Blink lnInvoiceCreate returned no invoice");
      return {
        method: "LIGHTNING", code: inv.paymentRequest, qr: `lightning:${inv.paymentRequest}`, asset: "BTC",
        amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
        providerRef: inv.paymentHash, provider: "blink",
      };
    }

    // ONCHAIN — a fresh on-chain BTC receive address on the BTC wallet. Settles via
    // the callback matched on the address (provisional: confirm Blink echoes the
    // address in its on-chain receive callback).
    const d = await gql<{ onChainAddressCreate: { address?: string; errors?: Array<{ message?: string }> } }>(
      M_ONCHAIN_ADDR, { input: { walletId: config.blink.walletId } },
    );
    throwUserErrors(d.onChainAddressCreate?.errors, "onChainAddressCreate");
    const addr = d.onChainAddressCreate?.address;
    if (!addr) throw new Error("Blink onChainAddressCreate returned no address");
    return {
      method: "ONCHAIN", code: addr, qr: `bitcoin:${addr}?amount=${req.amount.toFixed(8)}`, asset: "BTC",
      amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
      providerRef: addr, provider: "blink",
    };
  },

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined> = {}): boolean {
    return verifyBlink(rawBody, headers);
  },

  parseEvent(body: unknown): RailEvent | null {
    // Real Blink callback shape (dev.blink.sv/api/webhooks): a top-level `eventType`
    // ("receive.lightning" | "receive.onchain" | "send.*" | "*.intraledger") plus a
    // `transaction` { id, status, initiationVia { paymentHash | address, type },
    // settlementAmount (SATS), ... }. INBOUND is signalled by eventType `receive.*`
    // (there is no `direction` field). A defensive flat-shape fallback is kept too.
    const b = body as {
      eventType?: string;
      transaction?: {
        status?: string; settlementAmount?: number;
        initiationVia?: { paymentHash?: string; address?: string; type?: string };
      };
      paymentHash?: string; address?: string; status?: string; amount?: number;
    };
    const t = b.transaction ?? {};
    const iv = t.initiationVia ?? {};
    const eventType = (b.eventType ?? "").toLowerCase();
    if (eventType.startsWith("send.")) return null; // outbound — ignore

    const providerRef = iv.paymentHash ?? b.paymentHash ?? iv.address ?? b.address;
    if (!providerRef) return null;

    const status = (t.status ?? b.status ?? "").toUpperCase();
    if (status === "FAILURE") return null; // failed/expired — ignore
    const rawAmt = t.settlementAmount ?? b.amount;
    if (typeof rawAmt === "number" && rawAmt < 0) return null; // negative settlement = outbound

    const confirmed = status === "SUCCESS" || (eventType.startsWith("receive.") && typeof rawAmt === "number" && rawAmt > 0 && status === "");
    const detected = status === "PENDING";
    if (!confirmed && !detected) return null;
    const amount = typeof rawAmt === "number" && rawAmt !== 0 ? satToBtc(Math.abs(rawAmt)) : undefined;
    return { providerRef, kind: confirmed ? "confirmed" : "detected", amount };
  },

  // Authoritative re-query (LN by payment hash). On-chain addresses aren't pollable
  // here → transactionStatus returns {settled:false,failed:false}; the caller then
  // relies on the callback (secret-gated) + expiry, exactly like IBEX on-chain.
  confirmSettlement(providerRef: string): Promise<SettlementStatus | null> {
    return transactionStatus(providerRef);
  },
};

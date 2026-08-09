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

/* ---------- webhook (callback) auth ---------- */
/** Is the raw callback body authentic?
 *  Layered defence: (1) fail CLOSED when a Blink inbound could authorize a real
 *  payout but no secret is configured (mirrors IBEX). (2) With a secret, accept if
 *  an HMAC-SHA256(body, secret) matches a signature header (hex or svix `v1,<b64>`).
 *  (3) Sandbox/testing with no secret → accept. Real settlement is STILL gated by
 *  the authoritative confirmSettlement re-query, so this is defence-in-depth. */
function verifyBlink(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  const secret = config.blink.webhookSecret;
  if (!secret) return !blinkInboundTrusted(); // no secret → accept only when no real payout can result
  const header = (k: string) => { const v = headers[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  const provided = header("x-blink-signature") || header("blink-signature") || header("webhook-signature") || header("svix-signature");
  if (!provided) return false;
  const hexHmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // svix-style signed payload: `${svix-id}.${svix-timestamp}.${body}` → base64 HMAC,
  // header carries one or more space-separated `v1,<sig>` tokens.
  const svixId = header("svix-id"), svixTs = header("svix-timestamp");
  const b64Svix = svixId && svixTs
    ? crypto.createHmac("sha256", secret).update(`${svixId}.${svixTs}.${rawBody}`).digest("base64")
    : "";
  const eq = (a: string, b: string) => {
    const ab = Buffer.from(a), bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  };
  return provided.split(/[\s,]+/).some((tok) => tok && (eq(tok, hexHmac) || (b64Svix && eq(tok, b64Svix))));
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
    // Blink callback shape is provisional — parse defensively across likely layouts.
    // A "transaction" object with an initiationVia.paymentHash (LN) or an on-chain
    // address, a status/direction, and a settlementAmount (SATS).
    const b = body as {
      eventType?: string;
      transaction?: {
        status?: string; direction?: string; settlementAmount?: number;
        initiationVia?: { paymentHash?: string; address?: string };
        settlementVia?: { transactionHash?: string };
      };
      paymentHash?: string; address?: string; status?: string; amount?: number;
    };
    const t = b.transaction ?? {};
    const providerRef = t.initiationVia?.paymentHash ?? b.paymentHash ?? t.initiationVia?.address ?? b.address;
    if (!providerRef) return null;
    const status = (t.status ?? b.status ?? "").toUpperCase();
    const direction = (t.direction ?? "").toUpperCase();
    if (status === "FAILURE") return null; // failed/expired — ignore
    // Only inbound receives matter. If direction is absent, don't assume a send.
    if (direction && direction !== "RECEIVE") return null;
    const confirmed = status === "SUCCESS";
    const detected = status === "PENDING";
    if (!confirmed && !detected) return null;
    const sats = t.settlementAmount ?? b.amount;
    const amount = typeof sats === "number" && sats > 0 ? satToBtc(Math.abs(sats)) : undefined;
    return { providerRef, kind: confirmed ? "confirmed" : "detected", amount };
  },

  // Authoritative re-query (LN by payment hash). On-chain addresses aren't pollable
  // here → transactionStatus returns {settled:false,failed:false}; the caller then
  // relies on the callback (secret-gated) + expiry, exactly like IBEX on-chain.
  confirmSettlement(providerRef: string): Promise<SettlementStatus | null> {
    return transactionStatus(providerRef);
  },
};

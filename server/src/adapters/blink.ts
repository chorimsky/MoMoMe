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
import { bolt11AmountMsat, bolt11PaymentHash } from "../core/bolt11.js";
import type { InstructionRequest, OutboundResult, RailAdapter, RailEvent, SettlementStatus } from "./types.js";

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
type WalletTx = { status?: string; direction?: string };
/** Look the payment hash up in EVERY receiving wallet (BTC + USD/Stablesats), since a
 *  LN invoice may have been minted on either under BLINK_RECEIVE_POLICY. One aliased
 *  request; the USD wallet leg is included only when configured. */
function txByHashQuery(): string {
  const usd = config.blink.usdWalletId
    ? `usd: walletById(walletId: "${config.blink.usdWalletId}") { transactionsByPaymentHash(paymentHash: $paymentHash) { status direction } }`
    : "";
  return `query TxByHash($btc: WalletId!, $paymentHash: PaymentHash!) {
  me { defaultAccount {
    btc: walletById(walletId: $btc) { transactionsByPaymentHash(paymentHash: $paymentHash) { status direction } }
    ${usd}
  } }
}`;
}

/** Raw transactions matching a payment hash across BOTH wallets (or null on error). */
async function txsByHash(paymentHash: string): Promise<WalletTx[] | null> {
  try {
    const d = await gql<{ me?: { defaultAccount?: { btc?: { transactionsByPaymentHash?: WalletTx[] }; usd?: { transactionsByPaymentHash?: WalletTx[] } } } }>(
      txByHashQuery(), { btc: config.blink.walletId, paymentHash },
    );
    const acct = d.me?.defaultAccount;
    return [...(acct?.btc?.transactionsByPaymentHash ?? []), ...(acct?.usd?.transactionsByPaymentHash ?? [])];
  } catch {
    return null;
  }
}
const dirIs = (t: WalletTx, dir: string) => (t.direction ?? "").toUpperCase() === dir;
const statusIs = (t: WalletTx, s: string) => (t.status ?? "").toUpperCase() === s;

/** Was this Lightning invoice actually PAID (INBOUND)? Re-queries Blink by payment hash
 *  across both wallets. settled = a RECEIVE transaction with status SUCCESS; failed = a
 *  FAILURE tx and nothing settled. null when the lookup itself fails (network) —
 *  indeterminate, so the caller falls back to the (secret-gated) webhook and never
 *  over-settles. ON-CHAIN: an address isn't a payment hash and isn't pollable here →
 *  null (indeterminate), so the on-chain callback settles via the secret + amount
 *  re-check in confirmInbound instead of being wrongly reported "not settled". */
export async function transactionStatus(paymentHash: string): Promise<SettlementStatus | null> {
  if (!/^[0-9a-fA-F]{64}$/.test(paymentHash)) return null; // not an LN payment hash (e.g. an on-chain address)
  const txs = await txsByHash(paymentHash);
  if (!txs) return null;
  const settled = txs.some((t) => dirIs(t, "RECEIVE") && statusIs(t, "SUCCESS"));
  const failed = !settled && txs.some((t) => statusIs(t, "FAILURE"));
  return { settled, failed };
}

/** Status of an OUTBOUND (refund) payment by its payment hash: settled = a SEND tx with
 *  status SUCCESS; failed = a SEND FAILURE. null = indeterminate (lookup failed, or the
 *  send isn't yet recorded) → the refund poll keeps waiting. */
export async function sendStatus(paymentHash: string): Promise<SettlementStatus | null> {
  if (!/^[0-9a-fA-F]{64}$/.test(paymentHash)) return null;
  const txs = await txsByHash(paymentHash);
  if (!txs) return null;
  const settled = txs.some((t) => dirIs(t, "SEND") && statusIs(t, "SUCCESS"));
  const failed = txs.some((t) => dirIs(t, "SEND") && statusIs(t, "FAILURE"));
  if (!settled && !failed) return null; // no SEND tx yet → indeterminate, keep polling
  return { settled, failed: !settled && failed };
}

/* ---------- outbound (refund) — pay a BOLT11 from the BTC wallet ---------- */
// Refunds are Lightning + BTC-denominated (completeRefund gates method===LIGHTNING), so
// they always send from the BTC wallet. PaymentSendResult: SUCCESS | ALREADY_PAID |
// PENDING | FAILURE. We return the invoice's payment hash as the poll id.
const M_LN_PAYMENT_SEND = `mutation LnInvoicePaymentSend($input: LnInvoicePaymentInput!) {
  lnInvoicePaymentSend(input: $input) { status errors { message } }
}`;
const M_LN_NOAMOUNT_PAYMENT_SEND = `mutation LnNoAmountInvoicePaymentSend($input: LnNoAmountInvoicePaymentInput!) {
  lnNoAmountInvoicePaymentSend(input: $input) { status errors { message } }
}`;

async function payInvoiceOut(bolt11: string, amountMsat?: number): Promise<OutboundResult> {
  const hash = bolt11PaymentHash(bolt11);
  if (!hash) throw new Error("Blink refund: could not decode invoice payment hash");
  const amountless = bolt11AmountMsat(bolt11) === 0;
  let status: string; let errs: Array<{ message?: string }> | undefined;
  if (amountless) {
    // Amount-less invoice — WE set the amount (sats). completeRefund passes amountMsat.
    const sats = Math.round((amountMsat ?? 0) / 1000);
    if (sats < 1) throw new Error("Blink refund: amount-less invoice needs a positive amount");
    const d = await gql<{ lnNoAmountInvoicePaymentSend: { status?: string; errors?: Array<{ message?: string }> } }>(
      M_LN_NOAMOUNT_PAYMENT_SEND, { input: { walletId: config.blink.walletId, paymentRequest: bolt11, amount: sats } },
    );
    status = (d.lnNoAmountInvoicePaymentSend?.status ?? "").toUpperCase();
    errs = d.lnNoAmountInvoicePaymentSend?.errors;
  } else {
    const d = await gql<{ lnInvoicePaymentSend: { status?: string; errors?: Array<{ message?: string }> } }>(
      M_LN_PAYMENT_SEND, { input: { walletId: config.blink.walletId, paymentRequest: bolt11 } },
    );
    status = (d.lnInvoicePaymentSend?.status ?? "").toUpperCase();
    errs = d.lnInvoicePaymentSend?.errors;
  }
  throwUserErrors(errs, "lnInvoicePaymentSend");
  // FAILURE = definitively not paid → THROW so completeRefund holds for review (safe:
  // sats did not leave). SUCCESS/ALREADY_PAID = settled. PENDING = submitted; the refund
  // poll confirms via sendStatus by hash. (An ambiguous transport error already threw in gql.)
  if (status === "FAILURE") throw new Error("Blink refund: lnInvoicePaymentSend returned FAILURE");
  const settled = status === "SUCCESS" || status === "ALREADY_PAID";
  return { transactionId: hash, settled };
}

/* ---------- balances (both wallets) — treasury / ops visibility ---------- */
const Q_BALANCES = `query Balances {
  me { defaultAccount { wallets { id walletCurrency balance } } }
}`;

export interface BlinkBalance { walletId: string; currency: string; balance: number; }
/** Both wallet balances (BTC in sats, USD in cents) for treasury/ops. null on error. */
export async function blinkBalances(): Promise<BlinkBalance[] | null> {
  try {
    const d = await gql<{ me?: { defaultAccount?: { wallets?: Array<{ id?: string; walletCurrency?: string; balance?: number }> } } }>(Q_BALANCES, {});
    return (d.me?.defaultAccount?.wallets ?? [])
      .filter((w) => w.id)
      .map((w) => ({ walletId: w.id!, currency: (w.walletCurrency ?? "").toUpperCase(), balance: Number(w.balance ?? 0) }));
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

// Stablesats: an LN invoice against the USD wallet. Payer still pays SATS; the
// USD-equivalent at creation is credited to the USD wallet (no BTC price exposure).
// `amount` is USD CENTS (CentAmount!). Expiry is capped at 5 min by Blink (price lock).
const M_LN_USD_INVOICE = `mutation LnUsdInvoiceCreate($input: LnUsdInvoiceCreateInput!) {
  lnUsdInvoiceCreate(input: $input) {
    invoice { paymentRequest paymentHash }
    errors { message }
  }
}`;

const M_ONCHAIN_ADDR = `mutation OnChainAddressCreate($input: OnChainAddressCreateInput!) {
  onChainAddressCreate(input: $input) { address errors { message } }
}`;

/* ---------- wallet routing (BTC vs USD/Stablesats) ---------- */
type ReceiveTarget = { walletId: string; currency: "BTC" | "USD" };

/** Which Blink wallet receives this inbound, per BLINK_RECEIVE_POLICY:
 *   split — LIGHTNING → BTC (seconds; no Stablesats spread), ONCHAIN → USD (long
 *           confirmation window → hedge the BTC price move).
 *   hedge — everything → USD (max protection; pays the Stablesats spread each time).
 *   btc   — everything → BTC (hold Bitcoin).
 *  Any USD target with no usdWalletId configured falls back to BTC (never crashes). */
export function receiveTarget(method: Method): ReceiveTarget {
  const btc: ReceiveTarget = { walletId: config.blink.walletId, currency: "BTC" };
  const usdId = config.blink.usdWalletId;
  if (!usdId) return btc; // no Stablesats wallet → BTC only
  const usd: ReceiveTarget = { walletId: usdId, currency: "USD" };
  switch (config.blink.receivePolicy) {
    case "hedge": return usd;
    case "btc": return btc;
    case "split": return method === "ONCHAIN" ? usd : btc;
    default: return btc;
  }
}

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
    const target = receiveTarget(req.method);
    // The customer always PAYS Bitcoin (LN sats / on-chain BTC); asset/amount labels
    // stay BTC. `target.currency` only decides which Blink wallet is credited (USD =
    // Stablesats hedge). USD receive needs a USD figure — fall back to BTC if absent.
    const cents = Math.round((req.usd ?? 0) * 100);
    const wantUsd = target.currency === "USD" && cents >= 1;
    if (target.currency === "USD" && !wantUsd) {
      console.warn(`[blink] USD receive requested but no usable USD amount (usd=${req.usd}) — falling back to BTC wallet`);
    }

    if (req.method === "LIGHTNING") {
      if (wantUsd) {
        // Stablesats LN invoice — credited to the USD wallet as synthetic USD.
        const d = await gql<{ lnUsdInvoiceCreate: { invoice?: { paymentRequest?: string; paymentHash?: string }; errors?: Array<{ message?: string }> } }>(
          M_LN_USD_INVOICE, {
            input: {
              walletId: target.walletId,
              amount: cents, // USD cents (CentAmount!)
              memo: req.ref.slice(0, 64),
              expiresIn: Math.min(5, Math.max(1, Math.round(QUOTE_TTL_SEC.LIGHTNING / 60))), // Blink caps USD invoices at 5 min
            },
          },
        );
        throwUserErrors(d.lnUsdInvoiceCreate?.errors, "lnUsdInvoiceCreate");
        const inv = d.lnUsdInvoiceCreate?.invoice;
        if (!inv?.paymentRequest || !inv.paymentHash) throw new Error("Blink lnUsdInvoiceCreate returned no invoice");
        return {
          method: "LIGHTNING", code: inv.paymentRequest, qr: `lightning:${inv.paymentRequest}`, asset: "BTC",
          amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
          providerRef: inv.paymentHash, provider: "blink",
        };
      }
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

    // ONCHAIN — a fresh receive address on the target wallet (BTC, or the USD wallet
    // which auto-converts incoming on-chain BTC to Stablesats). Settles via the callback
    // matched on the address (provisional: confirm Blink echoes the address on-chain).
    const d = await gql<{ onChainAddressCreate: { address?: string; errors?: Array<{ message?: string }> } }>(
      M_ONCHAIN_ADDR, { input: { walletId: wantUsd ? target.walletId : config.blink.walletId } },
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
        status?: string; settlementAmount?: number; settlementCurrency?: string;
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
    // settlementAmount is in the CREDITED wallet's minor unit: sats for the BTC wallet,
    // USD cents for the Stablesats wallet. Only the BTC leg maps to an asset (BTC) amount
    // for the under/overpayment check; for a USD receive we leave amount undefined (the
    // authoritative confirmSettlement + the fixed invoice already gate it).
    const currency = (t.settlementCurrency ?? "").toUpperCase();
    const amount = currency !== "USD" && typeof rawAmt === "number" && rawAmt !== 0 ? satToBtc(Math.abs(rawAmt)) : undefined;
    return { providerRef, kind: confirmed ? "confirmed" : "detected", amount };
  },

  // Authoritative re-query (LN by payment hash). On-chain addresses aren't pollable
  // here → transactionStatus returns {settled:false,failed:false}; the caller then
  // relies on the callback (secret-gated) + expiry, exactly like IBEX on-chain.
  confirmSettlement(providerRef: string): Promise<SettlementStatus | null> {
    return transactionStatus(providerRef);
  },

  // Crypto-OUTBOUND (refunds) — pay the sender's BOLT11 from the BTC wallet, poll the
  // SEND transaction by hash. Makes "Blink without IBEX" cover refunds too.
  payInvoice(bolt11: string, amountMsat?: number): Promise<OutboundResult> {
    return payInvoiceOut(bolt11, amountMsat);
  },
  outboundStatus(txId: string): Promise<SettlementStatus | null> {
    return sendStatus(txId);
  },
};

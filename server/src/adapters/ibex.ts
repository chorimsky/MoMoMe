/* ============================================================
   IBEX Hub rail adapter — crypto inbound for Lightning + on-chain BTC.
   IBEX Hub (poweredbyibex.io) authenticates with OAuth2 client-credentials
   (M2M): client_id + client_secret + audience → short-lived access token,
   sent as a RAW `Authorization: <token>` header (no "Bearer" prefix).

   Amounts on a Bitcoin account (currencyId 0) are in MILLISATOSHIS both
   in (amountMsat) and out (transaction.amount) — verified live. USDT is
   gated per-organization (403), so it is NOT advertised here; the sandbox
   adapter simulates it until IBEX enables stablecoin receive.

   Settlement notifications: Lightning invoices carry a per-invoice webhook,
   and an ACCOUNT-level webhook (registerAccountWebhook) covers on-chain
   deposits and acts as the unified channel. IBEX doesn't HMAC-sign; it
   echoes the shared secret in the body and sends from a fixed IP set.
   ============================================================ */
import crypto from "node:crypto";
import type { Method, PayInstruction } from "../../../shared/types.js";
import { QUOTE_TTL_SEC, METHOD_ASSET } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import { config } from "../config.js";
import type { InstructionRequest, RailAdapter, RailEvent } from "./types.js";

const btcToMsat = (btc: number) => Math.round(btc * 1e11); // 1 BTC = 1e11 msat
const msatToBtc = (msat: number) => msat / 1e11;

/* ---------- OAuth2 client-credentials token manager (in-flight deduped) ---------- */
let cached: { accessToken: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

async function getAccessToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;
  // Dedupe concurrent token fetches so a burst of requests triggers one auth call.
  if (!inflight) {
    inflight = (async () => {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.ibex.clientId,
        client_secret: config.ibex.clientSecret,
        audience: config.ibex.audience,
      });
      const res = await fetch(config.ibex.authUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new Error(`IBEX auth failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { access_token: string; expires_in?: number };
      cached = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
      return data.access_token;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

/** Authenticated fetch with a single transparent re-auth on 401.
 *  IBEX Hub uses a RAW Authorization header (the token, no "Bearer "). */
async function ibex(path: string, init: RequestInit): Promise<Response> {
  const call = async (token: string) =>
    fetch(`${config.ibex.apiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: token, ...(init.headers ?? {}) },
    });
  let res = await call(await getAccessToken());
  if (res.status === 401) res = await call(await getAccessToken(true));
  return res;
}

/** Current IBEX FX rate: units of `toCurrencyId` per 1 `fromCurrencyId`
 *  (e.g. rate(2 BTC, 3 USD) → USD per BTC). null on lookup failure. */
export async function rate(fromCurrencyId: number, toCurrencyId: number): Promise<number | null> {
  const res = await ibex(`/rates?from=${fromCurrencyId}&to=${toCurrencyId}`, { method: "GET" });
  if (!res.ok) return null;
  const d = (await res.json()) as { rate?: number };
  return typeof d.rate === "number" ? d.rate : null;
}

/** Register the account-level webhook so on-chain deposits (and all account
 *  transactions) notify us. Idempotent on IBEX's side per account. Called at
 *  boot when IBEX is configured and PUBLIC_URL is publicly reachable. */
export async function registerAccountWebhook(): Promise<void> {
  const url = `${config.publicUrl}/webhooks/ibex`;
  // Register on every account we receive into — the Bitcoin account AND the USDT
  // account (if configured) — so on-chain BTC and ERC-20 USDT deposits both notify.
  const accounts = [config.ibex.accountId, config.ibex.usdtAccountId].filter(Boolean);
  for (const acct of accounts) {
    const res = await ibex(`/accounts/${acct}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ url, ...(config.ibex.webhookSecret ? { secret: config.ibex.webhookSecret } : {}) }),
    });
    // Already-registered is success, not failure (IBEX returns 409 or a 400
    // "webhook already exists") — tolerate both so boot doesn't log a false error.
    if (!res.ok && res.status !== 409) {
      const body = await res.text();
      if (!/already exists/i.test(body)) {
        throw new Error(`IBEX register account webhook failed (${acct}): ${res.status} ${body}`);
      }
    }
  }
}

/** Reconciliation backstop / "I've paid" check: was this Lightning invoice
 *  actually PAID? Query `GET /v2/transaction/{id}` (NOT /details — that endpoint
 *  returns no status and `usdAmount:0` for paid AND unpaid invoices, which made
 *  this silently never settle). The real signal is on the embedded invoice:
 *  `receiveMsat > 0` / `settleDateUtc` means sats were received; `state.name ===
 *  CANCEL` (or EXPIRED) means it expired unpaid. Returns null on lookup failure. */
export async function transactionStatus(transactionId: string): Promise<{ settled: boolean; failed: boolean } | null> {
  const res = await ibex(`/v2/transaction/${transactionId}`, { method: "GET" });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    settledAt?: string | null; usdAmount?: number;
    invoice?: { settleDateUtc?: string | null; receiveMsat?: number; state?: { name?: string } };
  };
  const inv = d.invoice ?? {};
  const settled =
    !!d.settledAt || !!inv.settleDateUtc ||
    (typeof inv.receiveMsat === "number" && inv.receiveMsat > 0) ||
    (typeof d.usdAmount === "number" && d.usdAmount > 0);
  const state = (inv.state?.name ?? "").toUpperCase();
  const failed = !settled && ["CANCEL", "CANCELED", "CANCELLED", "EXPIRED", "FAILED"].includes(state);
  return { settled, failed };
}

export interface PayResult { transactionId: string; settled: boolean; feesMsat?: number; }

/** Pay a BOLT11 invoice OUTBOUND from our account — used to REFUND a sender when a
 *  payout couldn't land. `amountMsat` is required for amount-less invoices. Returns the
 *  pay transactionId + whether it settled synchronously (else poll transactionStatus). */
export async function payInvoice(bolt11: string, amountMsat?: number): Promise<PayResult> {
  const res = await ibex("/invoice/pay", {
    method: "POST",
    body: JSON.stringify({ accountId: config.ibex.accountId, bolt11, ...(amountMsat ? { amountMSat: amountMsat } : {}) }),
  });
  if (!res.ok) throw new Error(`IBEX pay-invoice failed: ${res.status} ${await res.text()}`);
  const d = (await res.json()) as { transactionId: string; settleDateUtc?: string | null; feesMsat?: string };
  const settled = !!d.settleDateUtc && d.settleDateUtc !== "0";
  return { transactionId: d.transactionId, settled, feesMsat: d.feesMsat ? Number(d.feesMsat) : undefined };
}

/** Amount encoded in a BOLT11 invoice's HRP, in msat: 0 = amount-less; null = unparseable.
 *  Used to bound a refund so we can never over-pay a sender-supplied invoice. */
export function bolt11AmountMsat(bolt11: string): number | null {
  const s = bolt11.trim().toLowerCase();
  const sep = s.lastIndexOf("1"); // bech32 separator (data part excludes '1')
  if (sep <= 0) return null;
  const m = /^ln(bc|tb|bcrt)(\d*)([munp]?)$/.exec(s.slice(0, sep));
  if (!m) return null;
  if (!m[2]) return 0; // amount-less invoice
  const factor: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };
  return Math.round(Number(m[2]) * (factor[m[3]] ?? 1) * 1e11); // BTC→msat
}

/** Is the inbound webhook from an allowed IBEX sender IP? Checks the forwarded
 *  chain; if the IP can't be determined we don't block (the secret still gates). */
function ipAllowed(headers: Record<string, string | string[] | undefined>): boolean {
  const allow = config.ibex.webhookIps;
  if (!allow.length) return true;
  const xff = headers["x-forwarded-for"] ?? headers["x-real-ip"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (!raw) return true;
  return raw.split(",").map((s) => s.trim()).some((ip) => allow.includes(ip));
}

/** Per-stablecoin IBEX account (IBEX is account-per-currency). USDT = currencyId
 *  29, USDC = currencyId 30, both Ethereum/ERC-20. "" when not configured → the
 *  method isn't handled by IBEX and the sandbox adapter covers it. */
function stablecoinAccountId(m: Method): string {
  if (m === "USDT") return config.ibex.usdtAccountId;
  if (m === "USDC") return config.ibex.usdcAccountId;
  return "";
}

export const ibexAdapter: RailAdapter = {
  name: "ibex",
  // Stablecoins (USDT/USDC on Ethereum) are handled only when their dedicated IBEX
  // account is configured; otherwise the sandbox adapter covers them.
  supports: (m: Method) => m === "LIGHTNING" || m === "ONCHAIN" || !!stablecoinAccountId(m),

  async createInstruction(req: InstructionRequest): Promise<PayInstruction> {
    const expiresAt = new Date(Date.now() + QUOTE_TTL_SEC[req.method] * 1000).toISOString();

    if (req.method === "LIGHTNING") {
      const res = await ibex("/invoice/add", {
        method: "POST",
        body: JSON.stringify({
          accountId: config.ibex.accountId,
          amountMsat: btcToMsat(req.amount),
          memo: req.ref.slice(0, 50), // IBEX caps memo at 50 chars
          expiration: Math.min(QUOTE_TTL_SEC.LIGHTNING, 900), // IBEX max 15 min
          webhookUrl: req.callbackUrl,
          ...(config.ibex.webhookSecret ? { webhookSecret: config.ibex.webhookSecret } : {}),
        }),
      });
      if (!res.ok) throw new Error(`IBEX add-invoice failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { transactionId: string; bolt11: string; hash: string };
      return {
        // QR uses the `lightning:` BOLT11 URI scheme so wallets (Blink, Wallet of
        // Satoshi, …) recognise it as a Lightning invoice. A bare/uppercased
        // bolt11 is rejected by some scanners as "not a valid address".
        method: "LIGHTNING", code: data.bolt11, qr: `lightning:${data.bolt11}`, asset: "BTC",
        amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
        // The settlement webhook reports the same transaction by id.
        providerRef: data.transactionId, provider: "ibex",
      };
    }

    const stableAcct = stablecoinAccountId(req.method);
    if (stableAcct) {
      // Stablecoin on Ethereum (ERC-20) — a fresh receive address on the per-currency
      // account (USDT=29 / USDC=30). Settles via the account webhook, matched by 0x addr.
      const asset = METHOD_ASSET[req.method]; // "USDT" | "USDC"
      const res = await ibex(`/accounts/${stableAcct}/crypto/receive-infos`, {
        method: "POST",
        body: JSON.stringify({ name: req.ref.slice(0, 40), network: "ethereum" }),
      });
      if (!res.ok) throw new Error(`IBEX ${asset} receive-info failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { id: string; type?: string; data?: { address?: string } };
      const addr = data.data?.address;
      if (!addr) throw new Error(`IBEX ${asset} receive-info returned no address`);
      return {
        method: req.method, code: addr, qr: addr, asset,
        amount: req.amount, amountLabel: formatAmount(req.amount, asset), expiresAt,
        providerRef: addr, provider: "ibex",
      };
    }

    // ONCHAIN — fresh on-chain BTC receive address (settles via the account webhook).
    const res = await ibex("/onchain/address", {
      method: "POST",
      body: JSON.stringify({ accountId: config.ibex.accountId }),
    });
    if (!res.ok) throw new Error(`IBEX onchain-address failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { address: string };
    const addr = data.address;
    return {
      method: "ONCHAIN", code: addr, qr: `bitcoin:${addr}?amount=${req.amount.toFixed(8)}`, asset: "BTC",
      amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
      providerRef: addr, provider: "ibex",
    };
  },

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined> = {}): boolean {
    // 1) Sender IP allowlist (the documented IBEX webhook IPs), when determinable.
    if (!ipAllowed(headers)) return false;
    // 2) Shared secret echoed in the body. Without a configured secret we accept
    //    only outside production (assertIbexConfig requires it in production).
    if (!config.ibex.webhookSecret) return config.ibex.env !== "production";
    let provided = "";
    try { provided = (JSON.parse(rawBody) as { secret?: string }).secret ?? ""; } catch { return false; }
    const a = Buffer.from(provided);
    const b = Buffer.from(config.ibex.webhookSecret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  parseEvent(body: unknown): RailEvent | null {
    const t = (body as { transaction?: {
      id?: string; infoId?: string; amount?: number; status?: string; settledAt?: string | null;
      transactionTypeId?: number; currencyId?: number; address?: string; metadata?: { address?: string };
      invoice?: { settleDateUtc?: string | null; receiveMsat?: number; state?: { name?: string } };
    } }).transaction;
    if (!t) return null;
    const addr = t.address ?? t.metadata?.address;
    // Stablecoin (Ethereum/ERC-20) deposits: USDT=currencyId 29, USDC=30, or an 0x… addr.
    const isStable = t.currencyId === 29 || t.currencyId === 30 || (typeof addr === "string" && addr.toLowerCase().startsWith("0x"));
    // Lightning (typeId 1) matches by the stored transaction id. DEPOSITS — on-chain
    // BTC (typeId 7) and ERC-20 stablecoins — were stored with the address as providerRef,
    // so match the address IBEX echoes; fall back to id/infoId.
    const providerRef = (isStable && addr) || t.transactionTypeId === 7 ? (addr ?? t.infoId ?? t.id) : (t.id ?? t.infoId);
    if (!providerRef) return null;
    const status = (t.status ?? "").toLowerCase();
    const inv = t.invoice ?? {};
    const invState = (inv.state?.name ?? "").toUpperCase();
    const receivedMsat = typeof inv.receiveMsat === "number" && inv.receiveMsat > 0 ? inv.receiveMsat : undefined;
    if (status === "failed" || ["CANCEL", "CANCELED", "CANCELLED", "EXPIRED"].includes(invState)) return null; // expired/failed — ignore
    const confirmed = !!t.settledAt || !!inv.settleDateUtc || receivedMsat !== undefined
      || ["settled", "completed", "confirmed", "succeeded", "paid"].includes(status)
      || ["SETTLE", "SETTLED", "PAID", "ACCEPTED"].includes(invState);
    const detected = ["pending", "mempool", "unconfirmed", "processing", "detected"].includes(status);
    if (!confirmed && !detected) return null;
    // Amount for the underpayment guard. BTC: msat → BTC. USDT: ERC-20 base units
    // (6 decimals) → USDT. NOTE: the exact USDT amount field/units are provisional
    // until verified against a real deposit; assuming base-units (÷1e6) fails SAFE —
    // if IBEX reports a larger unit the guard under-counts → MANUAL_REVIEW, never overpay.
    let amount: number | undefined;
    if (isStable) amount = typeof t.amount === "number" ? t.amount / 1e6 : undefined;
    else amount = receivedMsat !== undefined ? msatToBtc(receivedMsat) : typeof t.amount === "number" ? msatToBtc(t.amount) : undefined;
    return { providerRef, kind: confirmed ? "confirmed" : "detected", amount };
  },
};

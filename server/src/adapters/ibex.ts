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
import { fetchT } from "./http.js";
import type { Method, PayInstruction } from "../../../shared/types.js";
import { QUOTE_TTL_SEC, METHOD_ASSET, btcToMsat, msatToBtc } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import { config, ibexConfigured, ibexInboundTrusted } from "../config.js";
import type { InstructionRequest, RailAdapter, RailEvent, SettlementStatus } from "./types.js";


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
      const res = await fetchT(config.ibex.authUrl, {
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
    fetchT(`${config.ibex.apiUrl}${path}`, {
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
  // Register on every account we receive into — the Bitcoin account AND each
  // configured stablecoin account (USDT + USDC) — so on-chain BTC and ERC-20
  // deposits all notify. (USDC was previously omitted → USDC deposits silently
  // never registered their webhook.) De-dupe in case ids coincide.
  const accounts = [...new Set([config.ibex.accountId, config.ibex.usdtAccountId, config.ibex.usdcAccountId].filter(Boolean))];
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
  // Truth signals ONLY: sats actually received. Do NOT use `usdAmount > 0` — this
  // file's own header documents it as `0` for paid AND unpaid invoices (and it may
  // carry the invoice's REQUESTED usd value before payment), so it can false-settle
  // an unpaid invoice → authorize a real Mobile-Money payout for crypto never received.
  const settled =
    !!d.settledAt || !!inv.settleDateUtc ||
    (typeof inv.receiveMsat === "number" && inv.receiveMsat > 0);
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

/* ---------- treasury withdrawal (OUTBOUND sweeps) ----------
   The platform accumulates crypto in its IBEX accounts as customers pay in. These
   let an admin sweep that inventory to a treasury wallet. All are real money — the
   caller (core/treasury) enforces the withdrawable ceiling, gating and audit. */

/** Real per-account balances from GET /v2/account, keyed by accountId →
 *  {currencyId, balance}. `balance` is in the account's smallest unit (BTC accounts
 *  in msat; stablecoin accounts in ERC-20 base units). Throws on lookup failure. */
export async function accountBalances(): Promise<Record<string, { currencyId: number; balance: number }>> {
  const res = await ibex("/v2/account", { method: "GET" });
  if (!res.ok) throw new Error(`IBEX account list failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id?: string; currencyId?: number; balance?: number }>;
  const out: Record<string, { currencyId: number; balance: number }> = {};
  for (const r of rows) if (r.id) out[r.id] = { currencyId: Number(r.currencyId ?? 0), balance: Number(r.balance ?? 0) };
  return out;
}

/** Open a custodial IBEX account — one per end user, which is IBEX's own documented
 *  model ("create an account for each of your users … one IBEXHub account per user"),
 *  and what turns a Mobile-Money number into a Lightning wallet that can HOLD sats
 *  rather than only forward them.
 *
 *  ⚠️ The request path/body below is the one part of this integration that could not be
 *  verified against the live API from the build environment (egress to
 *  docs.poweredbyibex.io and the API is blocked here, and no IBEX credentials are
 *  configured on the deployment). It follows this API's own house style — verb-suffixed
 *  v1 paths (`/invoice/add`, `/invoice/pay`, `/onchain/address`) — and returns the same
 *  account shape `GET /v2/account` lists (`{id, userId, organizationId, name,
 *  currencyId}`). Confirm it against the console before enabling on real money; every
 *  caller is written to fail SAFE if it is wrong (see provisionWallet in core/identity). */
export async function createAccount(name: string): Promise<string> {
  const res = await ibex("/account/create", { method: "POST", body: JSON.stringify({ name }) });
  if (!res.ok) throw new Error(`IBEX create-account failed: ${res.status} ${await res.text()}`);
  const d = (await res.json()) as { id?: string; accountId?: string };
  const id = d.id ?? d.accountId;
  if (!id) throw new Error("IBEX create-account returned no account id");
  return id;
}

/** Balance of ONE account (msat for a BTC account). Reads the same org-wide account
 *  list as accountBalances() — IBEX returns every account's balance in one call, so a
 *  per-user balance needs no extra endpoint. null = not an account we hold. */
export async function accountBalance(accountId: string): Promise<{ currencyId: number; balance: number } | null> {
  const all = await accountBalances();
  return all[accountId] ?? null;
}

/** Withdraw BTC ON-CHAIN to a Bitcoin address. `amountMsat` is the BTC account's
 *  smallest unit (msat). Returns the pay transaction id + provider status. */
export async function sendOnchain(address: string, amountMsat: number): Promise<{ txId: string; status: string }> {
  const res = await ibex("/v2/onchain/send", {
    method: "POST",
    body: JSON.stringify({ accountId: config.ibex.accountId, address, amount: amountMsat }),
  });
  if (!res.ok) throw new Error(`IBEX onchain-send failed: ${res.status} ${await res.text()}`);
  const d = (await res.json()) as { transactionHub?: { id?: string }; status?: string };
  return { txId: String(d.transactionHub?.id ?? ""), status: d.status ?? "INITIATED" };
}

/** Withdraw BTC over Lightning to a Lightning ADDRESS (user@domain). Resolves the
 *  address's LNURL-pay params (its .well-known endpoint), bounds-checks the amount,
 *  then pays via IBEX /v2/lnurl/pay/send. `amountMsat` must be within min/maxSendable. */
export async function payLightningAddress(lnAddress: string, amountMsat: number): Promise<PayResult> {
  const [name, domain] = lnAddress.split("@");
  if (!name || !domain) throw new Error("invalid lightning address");
  // Timeout-wrapped (fetchT): this LNURL resolve gates a real-money outbound sweep;
  // a hung .well-known host must not block it indefinitely (see http.ts).
  const lnurl = await fetchT(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`, { method: "GET" });
  if (!lnurl.ok) throw new Error(`lightning-address resolve failed: ${lnurl.status}`);
  const params = (await lnurl.json()) as { tag?: string; callback?: string; minSendable?: number; maxSendable?: number };
  if (params.tag !== "payRequest" || !params.callback) throw new Error("not a valid LNURL-pay address");
  if ((params.minSendable && amountMsat < params.minSendable) || (params.maxSendable && amountMsat > params.maxSendable)) {
    throw new Error("amount outside the destination's min/max sendable");
  }
  const res = await ibex("/v2/lnurl/pay/send", {
    method: "POST",
    body: JSON.stringify({ params: JSON.stringify(params), amount: amountMsat, accountId: config.ibex.accountId }),
  });
  if (!res.ok) throw new Error(`IBEX lnurl-pay failed: ${res.status} ${await res.text()}`);
  const d = (await res.json()) as { transaction?: { id?: string }; hash?: string; settleDateUtc?: number | string | null };
  const settled = !!d.settleDateUtc && d.settleDateUtc !== "0" && d.settleDateUtc !== 0;
  return { transactionId: String(d.transaction?.id ?? d.hash ?? ""), settled };
}

/** Is the inbound webhook from an allowed IBEX sender IP? Checks the forwarded
 *  chain; if the IP can't be determined we don't block (the secret still gates). */
/** IBEX documents the IPs its webhooks originate from, and their guidance is to check the
 *  secret AND the sender IP. Doing that correctly hinges on WHICH value you trust.
 *
 *  X-Forwarded-For is supplied by the caller. The previous implementation parsed it here
 *  and accepted a match ANYWHERE in the chain (`.some`), so anyone could send
 *  `X-Forwarded-For: 34.148.92.171` and satisfy the IP check outright — it added no
 *  security against a deliberate forgery, only against an accidental one. It also returned
 *  true when the header was absent, i.e. fail-open.
 *
 *  Express already resolves the real sender into req.ip using the configured proxy hop
 *  count (app.set("trust proxy", 1)), so that value — and only that value — is what an
 *  allowlist may be checked against. When it is available the decision is made on it
 *  alone, with EXACT membership. The header path survives solely for callers that cannot
 *  supply req.ip (internal replay, tests), where it is no weaker than before. */
function ipAllowed(headers: Record<string, string | string[] | undefined>, clientIp?: string): boolean {
  const allow = config.ibex.webhookIps;
  if (!allow.length) return true;
  // Trustworthy source: decide on it and nothing else. A resolved IP that is NOT on the
  // allowlist is a rejection, never a fall-through to the spoofable header.
  if (clientIp) return allow.includes(clientIp.replace(/^::ffff:/, ""));
  // No resolved sender — reachable only by callers that cannot supply req.ip (internal
  // replay, direct unit calls). Over HTTP, Express always sets req.ip, so the strong check
  // above is what production uses. Here we keep the original header scan: it is defence in
  // depth against misrouted or careless traffic and is no weaker than the previous
  // behaviour, but it is NOT a security boundary — X-Forwarded-For is caller-supplied, and
  // its entries cannot even be ranked without knowing the proxy topology (by the standard
  // the ORIGIN is leftmost and each hop appends to the right, so neither end is dependably
  // the sender). Anything that must not be forgeable relies on the shared secret and, for a
  // settlement, the authoritative confirmSettlement() re-query.
  const xff = headers["x-forwarded-for"] ?? headers["x-real-ip"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (!raw) return true; // nothing to check — the secret gates
  return raw.split(",").map((x) => x.trim().replace(/^::ffff:/, "")).some((ip) => allow.includes(ip));
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
  // IBEX is the BASE crypto rail — priority 0 so it's chosen ahead of any other
  // configured crypto rail for the methods it supports.
  priority: 0,
  configured: () => ibexConfigured(),
  trusted: () => ibexInboundTrusted(),
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
        // QR uses the `lightning:` BOLT11 URI scheme so wallets (Wallet of
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

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined> = {}, clientIp?: string): boolean {
    // 1) Sender IP allowlist (the documented IBEX webhook IPs), checked against the
    //    trust-proxy-resolved sender when available — see ipAllowed.
    if (!ipAllowed(headers, clientIp)) return false;
    // 2) Shared secret echoed in the body. Without a configured secret, accept ONLY
    //    when no real payout can result from an IBEX inbound (pure sandbox testing).
    //    If a payout CAN result (production, or IBEX_ALLOW_SANDBOX_PAYOUT), an unsigned
    //    webhook could settle real money → fail closed. assertIbexConfig enforces that
    //    the secret is set in exactly those cases, so this branch is sandbox-only.
    if (!config.ibex.webhookSecret) return !ibexInboundTrusted();
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

  // Authoritative re-query used by the webhook handler + reconcile backstop so a
  // forged/replayed "settled" webhook can never drive a real payout, and a lost
  // webhook still settles. null = indeterminate (e.g. an on-chain address).
  confirmSettlement(providerRef: string): Promise<SettlementStatus | null> {
    return transactionStatus(providerRef);
  },

  // Crypto-OUTBOUND (refunds / treasury) — IBEX pays a BOLT11 via /invoice/pay; the
  // outbound status re-uses the same authoritative transaction re-query as inbound.
  payInvoice: (bolt11: string, amountMsat?: number) => payInvoice(bolt11, amountMsat),
  outboundStatus: (txId: string) => transactionStatus(txId),

  // Custodial accounts — one Lightning wallet per Mobile-Money number.
  createAccount: (name: string) => createAccount(name),
  accountBalance: (accountId: string) => accountBalance(accountId),
};

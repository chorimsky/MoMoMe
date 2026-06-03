/* ============================================================
   IBEX rail adapter — Lightning + on-chain BTC + USDT (stablecoin).
   IBEX is the single inbound settlement provider: it issues Lightning
   invoices, on-chain BTC addresses, and USDT deposit addresses, all
   under one auth + webhook contract.

   NOTE: IBEX's exact request/response field names live behind an
   auth wall (docs.ibexmercado.com). The provider-specific shapes are
   isolated in the small marked sections below — confirm each against
   your IBEX sandbox before going live. The auth lifecycle, idempotency,
   sats handling, retry, and webhook verification are production-shaped.
   ============================================================ */
import crypto from "node:crypto";
import type { Method, PayInstruction } from "../../../shared/types.js";
import { QUOTE_TTL_SEC } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import { config } from "../config.js";
import type { InstructionRequest, RailAdapter, RailEvent } from "./types.js";

const btcToSats = (btc: number) => Math.round(btc * 1e8);

/* ---------- token manager (timeless refresh token → short-lived access token) ---------- */
let cached: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;
  const res = await fetch(`${config.ibex.apiUrl}/auth/refresh-access-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: config.ibex.refreshToken }),
  });
  if (!res.ok) throw new Error(`IBEX auth failed: ${res.status} ${await res.text()}`);
  // CONFIRM field names against IBEX docs:
  const data = (await res.json()) as { accessToken: string; expiresAt?: number };
  cached = { accessToken: data.accessToken, expiresAt: data.expiresAt ?? Date.now() + 10 * 60_000 };
  return cached.accessToken;
}

/** Authenticated fetch with a single transparent re-auth on 401. */
async function ibex(path: string, init: RequestInit): Promise<Response> {
  const call = async (token: string) =>
    fetch(`${config.ibex.apiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  let res = await call(await getAccessToken());
  if (res.status === 401) res = await call(await getAccessToken(true));
  return res;
}

export const ibexAdapter: RailAdapter = {
  name: "ibex",
  supports: (m: Method) => m === "LIGHTNING" || m === "ONCHAIN" || m === "USDT",

  async createInstruction(req: InstructionRequest): Promise<PayInstruction> {
    const expiresAt = new Date(Date.now() + QUOTE_TTL_SEC[req.method] * 1000).toISOString();

    if (req.method === "LIGHTNING") {
      // ---- CONFIRM shape against IBEX docs (POST /v2/invoice/add) ----
      const res = await ibex("/v2/invoice/add", {
        method: "POST",
        // Idempotency-Key avoids minting two invoices on a retried request.
        headers: { "Idempotency-Key": req.ref },
        body: JSON.stringify({
          accountId: config.ibex.accountId,
          amount: btcToSats(req.amount), // IBEX is denominated in sats
          memo: req.ref,
          expiration: QUOTE_TTL_SEC.LIGHTNING,
          webhookUrl: req.callbackUrl,
          webhookSecret: config.ibex.webhookSecret,
        }),
      });
      if (!res.ok) throw new Error(`IBEX add-invoice failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { bolt11: string; hash: string };
      const bolt11 = data.bolt11;
      return {
        method: "LIGHTNING", code: bolt11, qr: bolt11.toUpperCase(), asset: "BTC",
        amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
        providerRef: data.hash, provider: "ibex",
      };
    }

    if (req.method === "USDT") {
      // ---- CONFIRM shape against IBEX docs (USDT/stablecoin deposit address) ----
      // IBEX also settles USDT under the same account + webhook contract.
      const res = await ibex(`/v2/account/${config.ibex.accountId}/stablecoin-address`, {
        method: "POST",
        headers: { "Idempotency-Key": req.ref },
        body: JSON.stringify({ currency: "USDT", label: req.ref, webhookUrl: req.callbackUrl, webhookSecret: config.ibex.webhookSecret }),
      });
      if (!res.ok) throw new Error(`IBEX usdt-address failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { address: string };
      const addr = data.address;
      return {
        method: "USDT", code: addr, qr: addr, asset: "USDT",
        amount: req.amount, amountLabel: formatAmount(req.amount, "USDT"), expiresAt,
        providerRef: addr, provider: "ibex",
      };
    }

    // ONCHAIN ---- CONFIRM shape against IBEX docs (generate account address) ----
    const res = await ibex(`/v2/account/${config.ibex.accountId}/address`, {
      method: "POST",
      headers: { "Idempotency-Key": req.ref },
      body: JSON.stringify({ label: req.ref, webhookUrl: req.callbackUrl, webhookSecret: config.ibex.webhookSecret }),
    });
    if (!res.ok) throw new Error(`IBEX generate-address failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { address: string };
    const addr = data.address;
    return {
      method: "ONCHAIN", code: addr, qr: `bitcoin:${addr}?amount=${req.amount.toFixed(8)}`, asset: "BTC",
      amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
      providerRef: addr, provider: "ibex",
    };
  },

  verifyWebhook(rawBody: string, headers): boolean {
    const sig = headers["x-ibex-signature"];
    const provided = Array.isArray(sig) ? sig[0] : sig;
    if (!provided || !config.ibex.webhookSecret) return false;
    const expected = crypto.createHmac("sha256", config.ibex.webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  parseEvent(body: unknown): RailEvent | null {
    // ---- CONFIRM webhook shape against IBEX docs ----
    const e = body as { hash?: string; address?: string; status?: string; amount?: number; currency?: string; asset?: string };
    const providerRef = e.hash ?? e.address;
    if (!providerRef) return null;
    const status = (e.status ?? "").toUpperCase();
    const confirmed = ["SETTLED", "COMPLETED", "PAID", "CONFIRMED"].includes(status);
    const detected = ["PENDING", "DETECTED", "MEMPOOL", "UNCONFIRMED"].includes(status);
    if (!confirmed && !detected) return null;
    // IBEX reports amounts in the asset's smallest unit: sats (1e8) for BTC,
    // micro-USDT (1e6) for USDT. The webhook carries the currency/asset.
    const isUsdt = (e.currency ?? e.asset ?? "").toUpperCase() === "USDT";
    return {
      providerRef,
      kind: confirmed ? "confirmed" : "detected",
      amount: typeof e.amount === "number" ? e.amount / (isUsdt ? 1e6 : 1e8) : undefined,
    };
  },
};

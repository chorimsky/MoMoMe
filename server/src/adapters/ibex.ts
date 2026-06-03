/* ============================================================
   IBEX Hub rail adapter — crypto inbound for Lightning + on-chain BTC.
   IBEX Hub (poweredbyibex.io) authenticates with OAuth2 client-credentials
   (M2M): client_id + client_secret + audience → short-lived access token,
   sent as a RAW `Authorization: <token>` header (no "Bearer" prefix).

   USDT/stablecoin receive exists in the API but is gated per-organization
   (403 until IBEX enables it), so this adapter does NOT advertise USDT —
   the sandbox adapter handles it as a simulated rail until IBEX turns it on.

   Verified live against sandbox: token, GET /v2/account, POST /invoice/add,
   POST /onchain/address. The settlement-webhook matching/units are marked
   CONFIRM — they need a real paid invoice to finalize.
   ============================================================ */
import crypto from "node:crypto";
import type { Method, PayInstruction } from "../../../shared/types.js";
import { QUOTE_TTL_SEC } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import { config } from "../config.js";
import type { InstructionRequest, RailAdapter, RailEvent } from "./types.js";

const btcToMsat = (btc: number) => Math.round(btc * 1e11); // 1 BTC = 1e8 sat = 1e11 msat

/* ---------- OAuth2 client-credentials token manager ---------- */
let cached: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;
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
  return cached.accessToken;
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

export const ibexAdapter: RailAdapter = {
  name: "ibex",
  // USDT is intentionally excluded — gated per-org by IBEX; sandbox simulates it.
  supports: (m: Method) => m === "LIGHTNING" || m === "ONCHAIN",

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
        method: "LIGHTNING", code: data.bolt11, qr: data.bolt11.toUpperCase(), asset: "BTC",
        amount: req.amount, amountLabel: formatAmount(req.amount, "BTC"), expiresAt,
        // The settlement webhook reports the same transaction by id (CONFIRM).
        providerRef: data.transactionId, provider: "ibex",
      };
    }

    // ONCHAIN — generate a fresh on-chain BTC receive address for the account.
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

  verifyWebhook(rawBody: string): boolean {
    // IBEX Hub doesn't HMAC-sign webhooks; it echoes the per-invoice secret in
    // the body. Verify body.secret === our configured secret (+ pair with the
    // documented sender-IP allowlist at the edge for full security).
    if (!config.ibex.webhookSecret) return true; // no secret configured (sandbox) → accept
    let provided = "";
    try { provided = (JSON.parse(rawBody) as { secret?: string }).secret ?? ""; } catch { return false; }
    const a = Buffer.from(provided);
    const b = Buffer.from(config.ibex.webhookSecret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  parseEvent(body: unknown): RailEvent | null {
    const t = (body as { transaction?: {
      id?: string; infoId?: string; amount?: number; status?: string; settledAt?: string | null;
    } }).transaction;
    if (!t) return null;
    const providerRef = t.id ?? t.infoId; // CONFIRM the field that links to invoice/address
    if (!providerRef) return null;
    const status = (t.status ?? "").toUpperCase();
    const confirmed = !!t.settledAt || ["SETTLED", "COMPLETED", "CONFIRMED", "SUCCEEDED", "PAID"].includes(status);
    const detected = ["PENDING", "MEMPOOL", "UNCONFIRMED", "PROCESSING", "DETECTED"].includes(status);
    if (!confirmed && !detected) return null;
    return {
      providerRef,
      kind: confirmed ? "confirmed" : "detected",
      amount: typeof t.amount === "number" ? t.amount : undefined, // CONFIRM unit (assumed BTC)
    };
  },
};

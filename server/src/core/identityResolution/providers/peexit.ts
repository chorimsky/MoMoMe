/* Peexit wallet KYC — the one rail we already hold that answers "who owns this number".
   Peexit documents this TWICE with different names and shapes, and only one of them is on
   the production server (server.peexit.com answers 404 "Endpoint … not found." to the other):
     Get KYC        POST {base}/clients/verify_wallet  { countryCode: "cm", accountNumber }
                    200 { valid, accountTitle, accountStatus: "ACTIVE", accountType }        ← deployed
     Verify Wallet  POST {base}/clients/verify-wallet  { countryCode: "CM", accountNumber }
                    200 { isValid, accountName, operator, status }                             ← sandbox page
   Both are tried in that order (the second only when the first is a route-404), and both
   response shapes are read. Docs: https://peex-api-docs.peexit.com/get-kyc, /verify-wallet.
     404 "Account not found on the provider network"   422 unsupported country / bad params
   Authoritative for Cameroon MTN + Orange (the operators Peexit disburses to). A 200 without
   an accountName is a real, reachable account whose name the operator withholds — that is
   UNKNOWN with ACTIVE capabilities, never a fabricated name and never VERIFIED. */
import { peexitConfigured, peexitLive } from "../../../config.js";
import { peex } from "../../../adapters/peexit.js";
import type { IdentityProvider, IdentityContext, ProviderAnswer } from "./types.js";
import type { NormalizedIdentifier, IdentityProviderHealth } from "../../../../../shared/identity.js";
import { IdentityError } from "../errors.js";
import { last4 } from "../msisdn.js";

let lastLatency = 0, lastOk: boolean | null = null, lastError: string | undefined;
const caps = (ok: boolean) => ({ mobile_money: true, receive: ok, send: ok, payout: ok, collection: ok });

export const peexitVerify: IdentityProvider = {
  name: "peexit_verify",
  authoritative: true,
  configured: () => peexitConfigured(),
  // Peexit is a Cameroon aggregator: MTN and Orange XAF wallets only.
  supports: (country, operator) => country === "CM" && (operator === "MTN" || operator === "ORANGE"),
  async resolve(id: NormalizedIdentifier, ctx: IdentityContext): Promise<ProviderAnswer> {
    const t0 = Date.now();
    const national = id.nationalNumber ?? id.identifier.replace(/^\+/, "");
    type Body = { valid?: unknown; isValid?: unknown; accountTitle?: unknown; accountName?: unknown; accountStatus?: unknown; status?: unknown; operator?: unknown; accountType?: unknown; error?: { message?: unknown; statusCode?: unknown } };
    let res!: Response, text = "", body: Body = {}, upstreamMsg = "", path = "";
    // Read the body ONCE, whatever the status: Peexit's own message is what tells a 404
    // "Account not found on the provider network" apart from LoopBack's 404 "Endpoint …
    // not found." (the route missing on this base). The first is an answer about the
    // account; the second is our problem and must never reach a sender as "not found".
    for (const [i, candidate] of ["/clients/verify_wallet", "/clients/verify-wallet"].entries()) {
      path = candidate;
      try {
        res = await peex(candidate, { method: "POST", body: JSON.stringify({ countryCode: id.country.toLowerCase(), accountNumber: national }) }, ctx.timeoutMs);
      } catch (e) {
        lastLatency = Date.now() - t0; lastOk = false; lastError = (e as Error)?.name ?? "network";
        const timeout = /abort|timeout/i.test(String((e as Error)?.name ?? e));
        throw new IdentityError(timeout ? "IDENTITY_PROVIDER_TIMEOUT" : "IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `peexit ${candidate} …${last4(id.identifier)}: ${(e as Error)?.message ?? e}`, true);
      }
      text = await res.text().catch(() => "");
      try { body = text ? (JSON.parse(text) as Body) : {}; } catch { body = {}; }
      upstreamMsg = String(body.error?.message ?? (typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : "") ?? "").slice(0, 160) || (text.startsWith("<") ? "html body" : text.slice(0, 120));
      const routeMissing = res.status === 404 && /endpoint .* not found|cannot post/i.test(upstreamMsg) && !/account not found|provider network|no account/i.test(upstreamMsg);
      if (!(routeMissing && i === 0)) break; // only a missing FIRST route earns the second try
    }
    lastLatency = Date.now() - t0;
    const note = (why: string) => { lastError = `http ${res.status} ${path}: ${why}`; console.warn(`[identity] peexit ${path} …${last4(id.identifier)} → ${lastError}`); };
    if (res.status === 404) {
      if (/not found on the provider|account not found|no account|does not exist|introuvable/i.test(upstreamMsg)) { lastOk = true; lastError = undefined; return { status: "NOT_FOUND", verified: false, accountStatus: "UNKNOWN", capabilities: caps(false), provider: { name: "peexit_verify" }, error: "IDENTITY_NOT_FOUND" }; }
      lastOk = false; note(upstreamMsg || "no message (endpoint missing on this base?)");
      throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `peexit verify-wallet 404 without an account message: ${upstreamMsg}`, false);
    }
    if (res.status === 422) { lastOk = true; note(upstreamMsg); throw new IdentityError("IDENTITY_UNSUPPORTED_COUNTRY", "This number can't be verified yet.", `peexit verify-wallet 422: ${upstreamMsg}`, false); }
    if (res.status === 401 || res.status === 403) { lastOk = false; note(upstreamMsg || "key or IP allowlist"); throw new IdentityError("IDENTITY_PROVIDER_AUTH_ERROR", "Recipient verification is temporarily unavailable.", `peexit verify-wallet ${res.status} (key or IP allowlist): ${upstreamMsg}`, false); }
    if (!res.ok) { lastOk = false; note(upstreamMsg); throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `peexit verify-wallet ${res.status}: ${upstreamMsg}`, res.status >= 500); }
    // Either documented shape. valid/isValid, accountTitle/accountName, accountStatus/status.
    const validFlag = typeof body.valid === "boolean" ? body.valid : typeof body.isValid === "boolean" ? body.isValid : undefined;
    const name = (typeof body.accountTitle === "string" ? body.accountTitle : typeof body.accountName === "string" ? body.accountName : "").trim();
    const statusStr = String(body.accountStatus ?? body.status ?? "").toUpperCase();
    if (validFlag === undefined && !name && typeof body.operator !== "string") { lastOk = false; note(`unexpected 200 body: ${text.slice(0, 120)}`); throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", "peexit wallet KYC: 200 without the documented fields", false); }
    lastOk = true; lastError = undefined;
    const operator = typeof body.operator === "string" ? body.operator.toUpperCase() : null;
    const op = operator === "MTN" || operator === "ORANGE" ? operator : id.operator;
    // "valid" = the wallet can transact. valid:false with a status that says why → INACTIVE;
    // valid:false with nothing else → the network has no such wallet → NOT_FOUND.
    const active = validFlag !== false && (statusStr === "" || statusStr === "ACTIVE");
    if (validFlag === false && !name && !/INACTIVE|BLOCK|SUSPEND|BARR|CLOSED|DORMANT/i.test(statusStr)) return { status: "NOT_FOUND", verified: false, accountStatus: "UNKNOWN", capabilities: caps(false), provider: { name: "peexit_verify" }, error: "IDENTITY_NOT_FOUND", operator: op };
    const verifiedAt = new Date().toISOString();
    if (!active) return { status: "INACTIVE", verified: false, accountStatus: "INACTIVE", capabilities: caps(false), provider: { name: "peexit_verify", verifiedAt }, error: "IDENTITY_INACTIVE", operator: op };
    if (!name) return { status: "UNKNOWN", verified: false, accountStatus: "ACTIVE", capabilities: caps(true), provider: { name: "peexit_verify", verifiedAt }, operator: op };
    return { status: "VERIFIED", verified: true, displayName: name, accountStatus: "ACTIVE", capabilities: caps(true), provider: { name: "peexit_verify", verifiedAt }, operator: op };
  },
  async health(): Promise<IdentityProviderHealth> {
    const configured = peexitConfigured();
    return { name: this.name, configured, status: !configured ? "NOT_CONFIGURED" : lastOk === false ? "DOWN" : peexitLive() ? "OPERATIONAL" : "SANDBOX", supports: { operators: ["MTN", "ORANGE"], countries: ["CM"], resolve: true, verify: true }, latencyMs: lastLatency, successRate: lastOk === false ? 0 : 1, lastError };
  },
};

/* Peexit Verify-Wallet — the one rail we already hold that answers "who owns this number".
   Docs: https://peex-api-docs.peexit.com/verify-wallet
     POST {base}/clients/verify-wallet   header SECRETKEY   body { countryCode, accountNumber }
     200 { isValid, accountName?, operator: "MTN"|"ORANGE", status: "ACTIVE"|… }
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
    let res: Response;
    try {
      res = await peex("/clients/verify-wallet", {
        method: "POST",
        body: JSON.stringify({ countryCode: id.country, accountNumber: id.nationalNumber ?? id.identifier.replace(/^\+/, "") }),
      }, ctx.timeoutMs);
    } catch (e) {
      lastLatency = Date.now() - t0; lastOk = false; lastError = (e as Error)?.name ?? "network";
      const timeout = /abort|timeout/i.test(String((e as Error)?.name ?? e));
      throw new IdentityError(timeout ? "IDENTITY_PROVIDER_TIMEOUT" : "IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `peexit verify-wallet …${last4(id.identifier)}: ${(e as Error)?.message ?? e}`, true);
    }
    lastLatency = Date.now() - t0;
    if (res.status === 404) { lastOk = true; return { status: "NOT_FOUND", verified: false, accountStatus: "UNKNOWN", capabilities: caps(false), provider: { name: "peexit_verify" }, error: "IDENTITY_NOT_FOUND" }; }
    if (res.status === 422) { lastOk = true; throw new IdentityError("IDENTITY_UNSUPPORTED_COUNTRY", "This number can't be verified yet.", "peexit verify-wallet 422", false); }
    if (res.status === 401 || res.status === 403) { lastOk = false; lastError = `http ${res.status}`; throw new IdentityError("IDENTITY_PROVIDER_AUTH_ERROR", "Recipient verification is temporarily unavailable.", `peexit verify-wallet ${res.status} (key or IP allowlist)`, false); }
    if (!res.ok) { lastOk = false; lastError = `http ${res.status}`; throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `peexit verify-wallet ${res.status}`, res.status >= 500); }
    let body: { isValid?: unknown; accountName?: unknown; operator?: unknown; status?: unknown };
    try { body = (await res.json()) as typeof body; } catch { lastOk = false; throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", "peexit verify-wallet: non-JSON body", true); }
    lastOk = true; lastError = undefined;
    const operator = typeof body.operator === "string" ? body.operator.toUpperCase() : null;
    const op = operator === "MTN" || operator === "ORANGE" ? operator : id.operator;
    const active = body.isValid === true && String(body.status ?? "ACTIVE").toUpperCase() === "ACTIVE";
    const name = typeof body.accountName === "string" ? body.accountName.trim() : "";
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

/* CamPay holder lookup — the one provider on this chain that returns a real NAME.

     GET /holder_info/?phone_number=237XXXXXXXX
       200 { "full_name": "JOHN DOE" }
       404 { "message": "No name found" }

   That is the whole contract, and it is the cleanest of any verifier we have had.
   peexit_verify's host stopped resolving (NXDOMAIN at Peexit's own authoritative
   nameserver), and Payfonte's transfer-recipients/validate has no name field in its
   documented response — only a display label. Without this, every sender is told the
   recipient "can't be verified yet" and pays unchecked. Mobile Money does not reverse.

   Three outcomes, kept strictly apart, because conflating them is how a sender gets shown
   the wrong thing:
     a name            → VERIFIED
     404 "no name"     → NOT_FOUND, an answer about the number
     anything else     → a failure to ASK, which must never reach a sender as "not found"

   A 200 with an empty full_name is a reachable number whose name is withheld: UNKNOWN,
   never a fabricated name and never VERIFIED. Same rule the Peexit provider follows.

   Authoritative for Cameroon MTN + Orange — the operators CamPay serves (ER102: no other
   carrier is accepted). */
import { campayConfigured, campayLive } from "../../../config.js";
import { holderInfo } from "../../../adapters/campay.js";
import type { IdentityProvider, IdentityContext, ProviderAnswer } from "./types.js";
import type { NormalizedIdentifier, IdentityProviderHealth } from "../../../../../shared/identity.js";
import { IdentityError } from "../errors.js";
import { last4 } from "../msisdn.js";

let lastLatency = 0, lastOk: boolean | null = null, lastError: string | undefined;
const caps = (ok: boolean) => ({ mobile_money: true, receive: ok, send: ok, payout: ok, collection: ok });

export const campayHolder: IdentityProvider = {
  name: "campay_holder",
  authoritative: true,
  configured: () => campayConfigured(),
  supports: (country, operator) => country === "CM" && (operator === "MTN" || operator === "ORANGE"),

  async resolve(id: NormalizedIdentifier, ctx: IdentityContext): Promise<ProviderAnswer> {
    const t0 = Date.now();
    try {
      const name = await holderInfo(id.identifier, ctx.timeoutMs);
      lastLatency = Date.now() - t0; lastOk = true; lastError = undefined;
      if (name) {
        return { status: "VERIFIED", verified: true, displayName: name, accountStatus: "ACTIVE", capabilities: caps(true), provider: { name: "campay_holder", verifiedAt: new Date().toISOString() } };
      }
      // 404, or a 200 whose full_name was blank. CamPay answered; it has no name for this
      // number. That is NOT_FOUND — an answer — and the chain must stop here rather than
      // fall through to a provider that would guess.
      return { status: "NOT_FOUND", verified: false, accountStatus: "UNKNOWN", capabilities: caps(false), provider: { name: "campay_holder" }, error: "IDENTITY_NOT_FOUND" };
    } catch (e) {
      lastLatency = Date.now() - t0; lastOk = false;
      lastError = (e as Error)?.message?.slice(0, 160) ?? "network";
      console.warn(`[identity] campay holder_info …${last4(id.identifier)} → ${lastError}`);
      const m = /campay holder_info (\d{3})/.exec(lastError);
      const code = m ? Number(m[1]) : 0;
      // 401/403 is our credential or our account, and no retry fixes it: non-retryable, so
      // the resolver rests this provider instead of asking on every keystroke.
      if (code === 401 || code === 403) {
        throw new IdentityError("IDENTITY_PROVIDER_AUTH_ERROR", "Recipient verification is temporarily unavailable.", `campay holder_info ${code} (token refused)`, false);
      }
      // Everything else — timeout, 5xx, DNS — may well be transient: retryable, so the
      // chain can fail over to the next provider.
      throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `campay holder_info: ${lastError}`, true);
    }
  },

  async health(): Promise<IdentityProviderHealth> {
    const configured = campayConfigured();
    // lastOk === null means nothing has called it in THIS process: UNKNOWN, with no rate
    // and no latency. Reporting OPERATIONAL/1/0ms there is what made a dead verifier
    // announce itself healthy after every deploy (see identity-health-unknown.test.ts).
    return {
      name: this.name,
      configured,
      status: !configured ? "NOT_CONFIGURED" : lastOk === false ? "DOWN" : !campayLive() ? "SANDBOX" : lastOk === null ? "UNKNOWN" : "OPERATIONAL",
      supports: { operators: ["MTN", "ORANGE"], countries: ["CM"], resolve: true, verify: true },
      latencyMs: lastOk === null ? null : lastLatency,
      successRate: lastOk === null ? null : lastOk ? 1 : 0,
      lastError,
    };
  },
};

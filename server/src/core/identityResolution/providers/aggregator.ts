/* ============================================================
   Authorized aggregator (PawaPay). What its API actually offers for identity today:
     POST /v2/predict-provider  { phoneNumber } → { country, provider }   (operator only)
   It does NOT return an account holder's name, so this adapter can confirm/override the
   OPERATOR (useful where prefixes are ambiguous or portable) and say the number is
   reachable for payout — it cannot VERIFY. It answers UNKNOWN with operator + capabilities,
   never a name. A future aggregator endpoint that returns a verified name would be added
   here as an authoritative answer.
   ============================================================ */
import { fetchT } from "../../../adapters/http.js";
import { config, pawapayConfigured } from "../../../config.js";
import type { IdentityProvider, IdentityContext, ProviderAnswer } from "./types.js";
import type { NormalizedIdentifier, IdentityProviderHealth } from "../../../../../shared/identity.js";
import { IdentityError } from "../errors.js";
import { PROVIDER_CODES } from "../../network/pawapayMarkets.js";

const ISO3: Record<string, string> = { CM: "CMR", KE: "KEN", GH: "GHA", NG: "NGA", SN: "SEN", CI: "CIV", GA: "GAB", CG: "COG", TD: "TCD" };
const CM_CODES: Record<string, string> = { MTN: "MTN_MOMO_CMR", ORANGE: "ORANGE_CMR" };
/** Map a PawaPay provider code back to the market's operator id. */
function operatorFor(country: string, code: string): string | null {
  const table = country === "CM" ? CM_CODES : PROVIDER_CODES[country] ?? {};
  for (const [op, c] of Object.entries(table)) if (c === code) return op;
  return null;
}
const stats = { calls: 0, ok: 0, latency: [] as number[], lastError: "" };

export const aggregator: IdentityProvider = {
  name: "pawapay",
  authoritative: false, // it confirms reachability/operator, not identity
  configured: () => pawapayConfigured(),
  supports: (country) => country in ISO3,
  async resolve(id: NormalizedIdentifier, ctx: IdentityContext): Promise<ProviderAnswer> {
    const t0 = Date.now();
    try {
      const res = await fetchT(`${config.pawapay.apiUrl}/v2/predict-provider`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.pawapay.apiKey}` }, body: JSON.stringify({ phoneNumber: id.identifier.replace(/^\+/, "") }) }, ctx.timeoutMs);
      if (res.status === 401 || res.status === 403) throw new IdentityError("IDENTITY_PROVIDER_AUTH_ERROR", "Recipient verification is temporarily unavailable.", `pawapay predict ${res.status}`);
      if (!res.ok) throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `pawapay predict ${res.status}`, true);
      const d = (await res.json().catch(() => ({}))) as { country?: string; provider?: string };
      stats.calls++; stats.ok++; stats.latency.push(Date.now() - t0);
      const op = d.provider ? operatorFor(id.country, d.provider) : null;
      return { status: "UNKNOWN", verified: false, accountStatus: "UNKNOWN", operator: op ?? undefined, capabilities: { mobile_money: !!d.provider, receive: !!d.provider, send: false, payout: !!d.provider, collection: false }, provider: { name: "pawapay", reference: d.provider } };
    } catch (e) {
      stats.calls++; stats.latency.push(Date.now() - t0); stats.lastError = (e as Error)?.message ?? "";
      if (e instanceof IdentityError) throw e;
      throw new IdentityError(/abort|timeout/i.test(String((e as Error)?.message)) ? "IDENTITY_PROVIDER_TIMEOUT" : "IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", (e as Error)?.message, true);
    }
  },
  async health(): Promise<IdentityProviderHealth> {
    const rate = stats.calls ? stats.ok / stats.calls : null;
    return { name: this.name, configured: this.configured(), status: !this.configured() ? "NOT_CONFIGURED" : config.pawapay.env !== "production" ? "SANDBOX" : rate != null && rate < 0.5 ? "DOWN" : "OPERATIONAL", supports: { operators: ["*"], countries: Object.keys(ISO3), resolve: false, verify: false }, latencyMs: stats.latency.length ? Math.round(stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length) : null, successRate: rate, lastError: stats.lastError || undefined };
  },
};

/* Orange Money — no authorized account-holder lookup API is available to MoMo›Me today
   (Orange exposes none publicly; a contract-provided endpoint would be configured here).
   The adapter exists so the resolver's provider table is complete and honest: it reports
   NOT_CONFIGURED and never answers. Set ORANGE_IDENTITY_API_URL/ORANGE_IDENTITY_API_KEY
   once such an endpoint is contracted, then implement resolve() against it. */
import type { IdentityProvider } from "./types.js";
import type { IdentityProviderHealth } from "../../../../../shared/identity.js";
import { IdentityError } from "../errors.js";

const env = (k: string) => (process.env[k] ?? "").trim();
export const orangeDirect: IdentityProvider = {
  name: "orange_direct",
  authoritative: true,
  configured: () => !!(env("ORANGE_IDENTITY_API_URL") && env("ORANGE_IDENTITY_API_KEY")),
  supports: (country, operator) => operator === "ORANGE" && country === "CM",
  async resolve() { throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", "orange identity endpoint not implemented", false); },
  async health(): Promise<IdentityProviderHealth> {
    return { name: this.name, configured: this.configured(), status: this.configured() ? "DOWN" : "NOT_CONFIGURED", supports: { operators: ["ORANGE"], countries: ["CM"], resolve: false, verify: false }, latencyMs: null, successRate: null, lastError: this.configured() ? "endpoint contracted but not implemented" : undefined };
  },
};

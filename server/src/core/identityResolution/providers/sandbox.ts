/* The sandbox stand-in: deterministic fixtures for rehearsal ONLY. Refuses to exist when
   any real rail is live (liveMoney()) — the same rule that guards pawapay.lookupName. Its
   answers are labelled source "sandbox" and provider "sandbox" end to end; nothing it says
   can reach a production sender. */
import { config, liveMoney } from "../../../config.js";
import type { IdentityProvider, IdentityContext, ProviderAnswer } from "./types.js";
import type { NormalizedIdentifier, IdentityProviderHealth } from "../../../../../shared/identity.js";
import { IdentityError } from "../errors.js";

const NAMES = ["NANA JEAN PAUL", "AMINATOU BELLO", "NGO MARIE CLAIRE", "TCHOUMI ARMAND", "ABENA GRACE", "FOTSO ERIC", "MBALLA ROSE", "KAMDEM JOSEPH"];
export const sandboxProvider: IdentityProvider = {
  name: "sandbox",
  authoritative: false,
  configured: () => config.railsMode === "sandbox" && !liveMoney(),
  supports: () => true,
  async resolve(id: NormalizedIdentifier, _ctx: IdentityContext): Promise<ProviderAnswer> {
    if (liveMoney()) throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", "sandbox provider refused under live money");
    const n = id.nationalNumber ?? id.identifier;
    const last = +n[n.length - 1];
    if (n.endsWith("000")) throw new IdentityError("IDENTITY_PROVIDER_TIMEOUT", "Recipient verification is temporarily unavailable.", "simulated timeout", true);
    if (last === 9 && !n.endsWith("789")) return { status: "NOT_FOUND", verified: false, accountStatus: "UNKNOWN", capabilities: caps(false), provider: { name: "sandbox" }, error: "IDENTITY_NOT_FOUND" };
    if (last === 8) return { status: "INACTIVE", verified: false, accountStatus: "INACTIVE", capabilities: caps(false), provider: { name: "sandbox", verifiedAt: new Date().toISOString() }, error: "IDENTITY_INACTIVE" };
    let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    const name = n === "670123456" ? "NANA JEAN PAUL" : NAMES[h % NAMES.length];
    return { status: "VERIFIED", verified: true, displayName: name, accountStatus: "ACTIVE", capabilities: caps(true), provider: { name: "sandbox", reference: `sbx-${h.toString(16)}`, verifiedAt: new Date().toISOString() } };
  },
  async health(): Promise<IdentityProviderHealth> {
    return { name: this.name, configured: this.configured(), status: this.configured() ? "SANDBOX" : "NOT_CONFIGURED", supports: { operators: ["*"], countries: ["*"], resolve: true, verify: true }, latencyMs: 1, successRate: 1 };
  },
};
const caps = (ok: boolean) => ({ mobile_money: true, receive: ok, send: ok, payout: ok, collection: ok });

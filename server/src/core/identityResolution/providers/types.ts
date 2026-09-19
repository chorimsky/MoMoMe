/* The one interface every identity source implements — direct operator API, authorized
   aggregator, or the sandbox stand-in. The resolver only ever talks to this. */
import type { IdentityResolution, IdentityProviderHealth, NormalizedIdentifier, IdentityPurpose } from "../../../../../shared/identity.js";

export interface IdentityContext { purpose: IdentityPurpose; requestId: string; actor: string; paymentIntentId?: string; timeoutMs: number }

/** What a provider returns: everything the resolver needs to build an IdentityResolution
 *  except the parts the resolver owns (source, cache expiry, name match, requestId). */
export type ProviderAnswer = Pick<IdentityResolution, "status" | "verified" | "displayName" | "accountStatus" | "capabilities" | "provider" | "error"> & { operator?: string | null };

export interface IdentityProvider {
  readonly name: string;
  /** Credentials/endpoint present for THIS environment. Unconfigured providers are skipped. */
  configured(): boolean;
  /** Which market × operator pairs this provider can answer for. */
  supports(country: string, operator: string | null): boolean;
  /** Is this an authoritative source (the operator's own record or an authorized aggregator's)
   *  or the sandbox stand-in? The resolver refuses non-authoritative answers under live money. */
  readonly authoritative: boolean;
  resolve(id: NormalizedIdentifier, ctx: IdentityContext): Promise<ProviderAnswer>;
  health(): Promise<IdentityProviderHealth>;
}

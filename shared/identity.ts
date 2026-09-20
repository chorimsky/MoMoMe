/* ============================================================
   Identity Resolution — the shared vocabulary (docs/identity/*).

   A payment identity is IDENTIFIED (what kind of thing was typed), VERIFIED (does an
   authorized provider say it is a live account, and whose), UNDERSTOOD (what can be done
   with it) and then handed to the payment flow as an immutable snapshot. The type set is
   wider than Mobile Money on purpose: the same resolver will front MoMo›Me addresses,
   Lightning Addresses, UMA and bank accounts without a rewrite.
   ============================================================ */

/** What was typed. Only MSISDN → Mobile Money account is resolved today. */
export type IdentifierType = "MSISDN" | "EMAIL" | "MOMOME_ADDRESS" | "LIGHTNING_ADDRESS" | "UMA" | "BANK_ACCOUNT" | "MERCHANT_ID";

/** Explicit states. A timeout is PROVIDER_UNAVAILABLE, never NOT_FOUND. */
export type IdentityStatus =
  | "UNKNOWN"              // no authorized provider has said anything (no lookup possible)
  | "PENDING"              // a lookup is in flight
  | "VERIFIED"             // an authorized provider confirmed the account
  | "NOT_FOUND"            // the provider says there is no such account
  | "INACTIVE"             // the account exists but cannot receive
  | "UNSUPPORTED"          // country / operator / identifier type not resolvable here
  | "PROVIDER_UNAVAILABLE" // the provider timed out, errored or is not configured — retry later
  | "VERIFICATION_FAILED"; // the provider answered but the check itself failed (e.g. name mismatch on a strict check)

export type AccountStatus = "ACTIVE" | "INACTIVE" | "UNKNOWN";

/** Why an identity is being resolved. Required on every request: this is a payment
 *  identity engine, not a people search. */
export type IdentityPurpose = "RECIPIENT_VERIFICATION" | "PAYMENT_CREATION" | "PAYOUT_VALIDATION" | "TRANSACTION_CONFIRMATION" | "FRAUD_PREVENTION";
export const IDENTITY_PURPOSES: IdentityPurpose[] = ["RECIPIENT_VERIFICATION", "PAYMENT_CREATION", "PAYOUT_VALIDATION", "TRANSACTION_CONFIRMATION", "FRAUD_PREVENTION"];

import type { NameMatch } from "./domain.js";
export type { NameMatch };

export type IdentityErrorCode =
  | "IDENTITY_INVALID_IDENTIFIER" | "IDENTITY_UNSUPPORTED_COUNTRY" | "IDENTITY_UNSUPPORTED_OPERATOR" | "IDENTITY_NOT_FOUND"
  | "IDENTITY_INACTIVE" | "IDENTITY_PROVIDER_UNAVAILABLE" | "IDENTITY_PROVIDER_TIMEOUT" | "IDENTITY_PROVIDER_AUTH_ERROR"
  | "IDENTITY_VERIFICATION_FAILED" | "IDENTITY_RATE_LIMITED" | "IDENTITY_UNAUTHORIZED" | "IDENTITY_DISABLED";

export interface IdentityCapabilities { mobile_money: boolean; receive: boolean; send: boolean; payout: boolean; collection: boolean }

/** The normalized identifier — every consumer works from this, never from the raw input. */
export interface NormalizedIdentifier {
  type: IdentifierType;
  /** E.164 for MSISDN ("+237674123456"). */
  identifier: string;
  countryCode?: string;     // "237"
  nationalNumber?: string;  // "674123456"
  country: string;          // ISO-3166 alpha-2
  operator: string | null;  // "MTN" | "ORANGE" | "MPESA" … as the market table names them
  currency: string | null;
}

/** The normalized result every provider is mapped into. */
export interface IdentityResolution {
  identifier: string;
  identifierType: IdentifierType;
  country: string;
  operator: string | null;
  currency: string | null;
  status: IdentityStatus;
  verified: boolean;
  /** The account holder's display name as the PROVIDER returned it. Never inferred. */
  displayName?: string;
  accountStatus: AccountStatus;
  capabilities: IdentityCapabilities;
  provider: { name: string; reference?: string; verifiedAt?: string };
  /** Where this answer came from: a live provider call, the verification cache, or the
   *  sandbox provider (only ever outside live money). */
  source: "provider" | "cache" | "sandbox" | "none";
  /** When the cached verification stops being usable. */
  expiresAt?: string;
  /** Optional name check against what the caller expected. */
  nameMatch?: NameMatch;
  /** Machine-readable reason for a non-VERIFIED status. Never provider internals. */
  error?: IdentityErrorCode;
  requestId: string;
}

/** What a payment carries once the recipient was resolved — immutable after the payment
 *  reaches an execution-critical state. No raw provider payload, no more than needed. */
export interface RecipientIdentitySnapshot {
  identifier: string;      // E.164
  country: string;
  operator: string | null;
  currency: string | null;
  status: IdentityStatus;
  verified: boolean;
  displayName?: string;
  provider: string;
  verifiedAt?: string;
  nameMatch?: NameMatch;
  requestId: string;
}

/** Provider health as the console shows it. */
export interface IdentityProviderHealth {
  name: string;
  configured: boolean;
  status: "OPERATIONAL" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED" | "SANDBOX";
  supports: { operators: string[]; countries: string[]; resolve: boolean; verify: boolean };
  latencyMs: number | null;
  successRate: number | null;
  lastError?: string;
}

/** Per market × operator: which capabilities an AUTHORIZED provider actually gives us. */
export interface IdentityCapabilityConfig { identity_resolution: boolean; payout: boolean; collection: boolean; provider: string | null }

/* ---------- client-facing (what POST /api/v2/identity/resolve returns) ---------- */
/** The public identity (never a provider reference, never a raw provider payload). */
export interface PublicIdentity {
  verified: boolean;
  status: IdentityStatus;
  display_name?: string;
  country: string;
  operator: string | null;
  currency: string | null;
  account_status: AccountStatus;
  capabilities: IdentityCapabilities;
  name_match?: NameMatch;
  provider: string | null;
  verified_at?: string;
  expires_at?: string;
  request_id: string;
  error?: IdentityErrorCode;
}
export interface IdentityResolveResponse {
  success: boolean;
  identity: PublicIdentity;
  /** Plain-language line for the sender (present when not VERIFIED). */
  message?: string;
  mode: "advisory" | "gate";
}
